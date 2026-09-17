import Foundation
import NaturalLanguage
import Translation

// Morse Desktop on-device chat translation. The language gate and source guess follow
// MorseMessenger iOS (MorseChatTranslateLanguageGate, AppleSystemTranslateFallback); the
// translation itself is Apple's Translation framework with installed languages only, so
// message text never leaves this Mac. One JSON request per line on stdin, one reply per line.

let onDeviceRoots: Set<String> = [
    "ar", "zh", "nl", "en", "fr", "de", "hi", "id", "it", "ja", "ko",
    "pl", "pt", "ru", "es", "th", "tr", "uk", "vi",
    "da", "nb", "sv", "fi", "cs", "el", "he", "hu", "ro", "sk", "ms", "yue"
]

func languageRoot(_ identifier: String) -> String {
    (identifier.split(separator: "-").first.map(String.init) ?? identifier).lowercased()
}

func scriptLetterCounts(_ sample: String) -> (hangul: Int, latin: Int, cyrillic: Int) {
    var hangul = 0, latin = 0, cyrillic = 0
    for character in sample {
        var placed = false
        for scalar in character.unicodeScalars {
            let value = scalar.value
            if (0xAC00...0xD7AF).contains(value) || (0x1100...0x11FF).contains(value) || (0x3130...0x318F).contains(value) {
                hangul += 1; placed = true; break
            }
            if (0x0400...0x04FF).contains(value) || (0x0500...0x052F).contains(value) || (0x2DE0...0x2DFF).contains(value) {
                cyrillic += 1; placed = true; break
            }
            if (0x0041...0x005A).contains(value) || (0x0061...0x007A).contains(value) {
                latin += 1; placed = true; break
            }
        }
        if !placed, character.isLetter { latin += 1 }
    }
    return (hangul, latin, cyrillic)
}

func scriptSuggestsDifferentLanguage(_ scripts: (hangul: Int, latin: Int, cyrillic: Int), ui: String) -> Bool {
    let h = scripts.hangul, l = scripts.latin, c = scripts.cyrillic
    guard h + l + c >= 2 else { return false }
    switch ui {
    case "ko":
        if c >= 2, h * 3 < c { return true }
        if l >= 8, h + c < max(2, l / 4) { return true }
        return false
    case "ru":
        if h >= 3 { return true }
        if l >= 10, c <= max(3, l / 5), h == 0 { return true }
        if h >= 2, c * 2 < h { return true }
        return false
    default:
        return h >= 3 || c >= 3
    }
}

func onlySymbols(_ text: String) -> Bool {
    for character in text where !character.isWhitespace && !character.isNewline {
        if character.isLetter || character.isNumber { return false }
    }
    return true
}

// MorseChatTranslateLanguageGate.peerPlainTextDiffersFromUI
func differsFromInterface(_ raw: String, ui: String) -> Bool {
    let sample = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !sample.isEmpty, !onlySymbols(sample) else { return false }
    let scripts = scriptLetterCounts(sample)
    if scriptSuggestsDifferentLanguage(scripts, ui: ui) { return true }
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(sample)
    guard let dominant = recognizer.dominantLanguage, dominant != .undetermined else {
        return scriptSuggestsDifferentLanguage(scripts, ui: ui)
    }
    let hypotheses = recognizer.languageHypotheses(withMaximum: 12)
    guard let probability = hypotheses[dominant], probability >= 0.05 else {
        return scriptSuggestsDifferentLanguage(scripts, ui: ui)
    }
    if languageRoot(dominant.rawValue) == ui { return false }
    if ui == "ko" {
        if let korean = hypotheses[.korean], korean >= 0.14 { return false }
        let denominator = scripts.hangul + scripts.latin
        if denominator > 0, scripts.hangul >= 8, Double(scripts.hangul) / Double(denominator) >= 0.17 { return false }
    } else if ui == "ru" {
        if let russian = hypotheses[.russian], russian >= 0.14 { return false }
        let denominator = scripts.cyrillic + scripts.latin
        if denominator > 0, scripts.cyrillic >= 8, Double(scripts.cyrillic) / Double(denominator) >= 0.17 { return false }
    }
    return true
}

// AppleSystemTranslateFallback.inferredSourceLanguage
func inferredSource(_ text: String, target: String) -> Locale.Language {
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(text)
    if let dominant = recognizer.dominantLanguage, dominant != .undetermined {
        var code = dominant.rawValue
        if code == "kk", scriptLetterCounts(text).cyrillic > 0 { code = "ru" }
        if onDeviceRoots.contains(languageRoot(code)) { return Locale.Language(identifier: code) }
    }
    return Locale.Language(identifier: target == "en" ? "ko" : "en")
}

actor Translator {
    private var sessions: [String: TranslationSession] = [:]

    func translate(_ raw: String, target: String) async -> [String: Any] {
        let text = raw.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !onlySymbols(text) else { return ["status": "same-language"] }
        let targetLanguage = Locale.Language(identifier: target)
        let source = inferredSource(text, target: target)
        if languageRoot(source.minimalIdentifier) == languageRoot(target) { return ["status": "same-language"] }
        switch await LanguageAvailability().status(from: source, to: targetLanguage) {
        case .installed:
            let key = "\(source.minimalIdentifier)>\(target)"
            let session = sessions[key] ?? TranslationSession(installedSource: source, target: targetLanguage)
            sessions[key] = session
            do {
                let response = try await session.translate(text)
                let translated = response.targetText.trimmingCharacters(in: .whitespacesAndNewlines)
                return translated.isEmpty ? ["status": "failed"] : ["status": "translated", "text": translated]
            } catch {
                sessions[key] = nil
                return ["status": "failed"]
            }
        case .supported:
            return ["status": "not-installed"]
        default:
            return ["status": "unsupported"]
        }
    }
}

actor Output {
    func send(_ value: [String: Any]) {
        guard var data = try? JSONSerialization.data(withJSONObject: value) else { return }
        data.append(0x0A)
        FileHandle.standardOutput.write(data)
    }
}

@main
struct MorseTranslate {
    static func main() async {
        let translator = Translator(), output = Output()
        do {
            for try await line in FileHandle.standardInput.bytes.lines {
                guard let data = line.data(using: .utf8),
                      let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let id = request["id"] as? String, let op = request["op"] as? String,
                      let text = request["text"] as? String, let target = request["target"] as? String,
                      ["ko", "en", "ru"].contains(target) else { continue }
                if op == "gate" {
                    await output.send(["id": id, "differs": differsFromInterface(text, ui: target)])
                } else if op == "translate" {
                    Task {
                        let result = await translator.translate(text, target: target)
                        await output.send(result.merging(["id": id]) { current, _ in current })
                    }
                }
            }
        } catch {}
    }
}

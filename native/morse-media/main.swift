import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import ImageIO
import QuartzCore
import Speech
import UniformTypeIdentifiers
import Vision

// Morse Desktop media helper. «배경 제거» follows MorseMessenger iOS MorseStickerEditor.cutout (Vision's foreground
// instance mask over the picture, turned upright and at most 2048px), and «음성→텍스트» follows
// MorseVoiceTranscriptService (Speech framework, the recognizer for the app's language, server recognition allowed).
// One JSON request per line on stdin, one reply per line on stdout; nothing is written to disk but the short-lived
// audio file the recognizer reads, removed as soon as it has been read.

enum HelperFailure: Error { case unreadable, noSubject, failed }

func uprightImage(_ data: Data) throws -> CGImage {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw HelperFailure.unreadable }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: 2048
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw HelperFailure.unreadable }
    return image
}

// Vision's foreground instance mask exists from macOS 14; the helper itself runs from macOS 13.
@available(macOS 14.0, *)
func cutout(_ data: Data) throws -> Data {
    let image = try uprightImage(data)
    let handler = VNImageRequestHandler(cgImage: image)
    let request = VNGenerateForegroundInstanceMaskRequest()
    try handler.perform([request])
    guard let observation = request.results?.first, !observation.allInstances.isEmpty else { throw HelperFailure.noSubject }
    let mask = try observation.generateScaledMaskForImage(forInstances: observation.allInstances, from: handler)
    let input = CIImage(cgImage: image)
    let filter = CIFilter.blendWithMask()
    filter.inputImage = input
    filter.backgroundImage = CIImage(color: .clear).cropped(to: input.extent)
    filter.maskImage = CIImage(cvPixelBuffer: mask)
    guard let output = filter.outputImage,
          let result = CIContext().createCGImage(output, from: input.extent, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)) else { throw HelperFailure.failed }
    let encoded = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(encoded, UTType.png.identifier as CFString, 1, nil) else { throw HelperFailure.failed }
    CGImageDestinationAddImage(destination, result, nil)
    guard CGImageDestinationFinalize(destination) else { throw HelperFailure.failed }
    return encoded as Data
}

// iOS VideoRecorderView.exportMP4 (VideoSendQuality): the picked video is exported again with the preset the send
// quality names, as an MP4 prepared for streaming. Only the three presets iOS uses are accepted.
let videoPresets = ["960x540": AVAssetExportPreset960x540, "1280x720": AVAssetExportPreset1280x720, "medium": AVAssetExportPresetMediumQuality]

func uprightSize(_ track: AVAssetTrack) async throws -> CGSize {
    let natural = try await track.load(.naturalSize), transform = try await track.load(.preferredTransform)
    let size = natural.applying(transform)
    return CGSize(width: abs(size.width), height: abs(size.height))
}

// Editor::VideoEditor's from/till: with `start` and `end` only that part of the picked file is exported. With an
// `overlay` picture (iOS MorseVideoMarkupExporter), the drawing is laid over every frame of that part at the upright
// video size through AVVideoCompositionCoreAnimationTool, the sound kept.
func compressVideo(input: URL, output: URL, preset: String, maxSeconds: Double, start: Double? = nil, end: Double? = nil, overlay: URL? = nil) async -> [String: Any] {
    guard let name = videoPresets[preset] else { return ["status": "failed"] }
    let asset = AVURLAsset(url: input)
    guard let length = try? await asset.load(.duration).seconds, length.isFinite, length > 0 else { return ["status": "failed"] }
    if length > maxSeconds { return ["status": "too-long"] }
    let from = max(0, start ?? 0), till = min(length, end ?? length)
    guard from.isFinite, till.isFinite, till - from >= 0.5 else { return ["status": "failed"] }
    let range = CMTimeRange(start: CMTime(seconds: from, preferredTimescale: 600), end: CMTime(seconds: till, preferredTimescale: 600))
    let session: AVAssetExportSession
    if let overlay {
        guard let (composition, videoComposition) = await markupComposition(asset: asset, range: range, overlay: overlay),
              let made = AVAssetExportSession(asset: composition, presetName: name) else { return ["status": "failed"] }
        made.videoComposition = videoComposition
        session = made
    } else {
        guard let made = AVAssetExportSession(asset: asset, presetName: name) else { return ["status": "failed"] }
        if start != nil || end != nil { made.timeRange = range }
        session = made
    }
    session.shouldOptimizeForNetworkUse = true
    try? FileManager.default.removeItem(at: output)
    do { try await session.export(to: output, as: .mp4) } catch { try? FileManager.default.removeItem(at: output); return ["status": "failed"] }
    let result = AVURLAsset(url: output)
    do {
        guard let track = try await result.loadTracks(withMediaType: .video).first else { throw HelperFailure.failed }
        let size = try await uprightSize(track), duration = try await result.load(.duration)
        return ["status": "ok", "width": Int(size.width.rounded()), "height": Int(size.height.rounded()), "duration": duration.seconds]
    } catch {
        try? FileManager.default.removeItem(at: output)
        return ["status": "failed"]
    }
}

// MorseVideoMarkupExporter.makeComposition / makeVideoComposition: the chosen part of the video and sound tracks, and
// the drawing stretched over the upright frame above the video layer.
func markupComposition(asset: AVURLAsset, range: CMTimeRange, overlay: URL) async -> (AVMutableComposition, AVMutableVideoComposition)? {
    guard let source = CGImageSourceCreateWithURL(overlay as CFURL, nil), let picture = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
    do {
        guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else { return nil }
        let natural = try await videoTrack.load(.naturalSize), transform = try await videoTrack.load(.preferredTransform)
        let upright = CGRect(origin: .zero, size: natural).applying(transform)
        let renderSize = CGSize(width: abs(upright.width).rounded(), height: abs(upright.height).rounded())
        guard renderSize.width >= 2, renderSize.height >= 2 else { return nil }
        let audioTrack = try await asset.loadTracks(withMediaType: .audio).first
        let composition = AVMutableComposition()
        guard let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { return nil }
        try video.insertTimeRange(range, of: videoTrack, at: .zero)
        if let audioTrack, let audio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            try audio.insertTimeRange(range, of: audioTrack, at: .zero)
        }
        let parent = CALayer(), videoLayer = CALayer(), drawingLayer = CALayer()
        parent.frame = CGRect(origin: .zero, size: renderSize)
        videoLayer.frame = parent.bounds
        drawingLayer.frame = parent.bounds
        drawingLayer.contents = picture
        drawingLayer.contentsGravity = .resize
        parent.addSublayer(videoLayer)
        parent.addSublayer(drawingLayer)
        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = renderSize
        videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
        videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: videoLayer, in: parent)
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: range.duration)
        let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: video)
        // A rotation stored without its offset would draw the picture outside the frame; move it back into view.
        layer.setTransform(transform.concatenating(CGAffineTransform(translationX: -upright.minX, y: -upright.minY)), at: .zero)
        instruction.layerInstructions = [layer]
        videoComposition.instructions = [instruction]
        return (composition, videoComposition)
    } catch { return nil }
}

// «스티커 만들기» for a GIF: every frame cut to the chosen square, drawn at the sticker size, with its own delay and
// the file's loop count kept.
func cropGIF(_ data: Data, rect: CGRect, side: Int) throws -> Data {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw HelperFailure.unreadable }
    let count = CGImageSourceGetCount(source)
    guard count > 0, count <= 1000 else { throw HelperFailure.unreadable }
    let encoded = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(encoded, UTType.gif.identifier as CFString, count, nil),
          let space = CGColorSpace(name: CGColorSpace.sRGB) else { throw HelperFailure.failed }
    let fileGIF = (CGImageSourceCopyProperties(source, nil) as? [CFString: Any])?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
    CGImageDestinationSetProperties(destination, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: fileGIF?[kCGImagePropertyGIFLoopCount] ?? 0]] as CFDictionary)
    for index in 0..<count {
        guard let frame = CGImageSourceCreateImageAtIndex(source, index, nil) else { throw HelperFailure.unreadable }
        let area = rect.integral.intersection(CGRect(x: 0, y: 0, width: frame.width, height: frame.height))
        guard !area.isNull, area.width >= 1, area.height >= 1, let cropped = frame.cropping(to: area),
              let context = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw HelperFailure.failed }
        context.interpolationQuality = .high
        context.draw(cropped, in: CGRect(x: 0, y: 0, width: side, height: side))
        guard let scaled = context.makeImage() else { throw HelperFailure.failed }
        let frameGIF = (CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any])?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
        let delay = frameGIF?[kCGImagePropertyGIFUnclampedDelayTime] ?? frameGIF?[kCGImagePropertyGIFDelayTime] ?? 0.1
        CGImageDestinationAddImage(destination, scaled, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: delay]] as CFDictionary)
    }
    guard CGImageDestinationFinalize(destination) else { throw HelperFailure.failed }
    return encoded as Data
}

// The same for an MP4: the picture turned upright, cut to the square and drawn at the sticker size, without sound.
func cropVideo(_ data: Data, rect: CGRect, side: Int) async throws -> Data {
    let folder = FileManager.default.temporaryDirectory
    let input = folder.appendingPathComponent("morse-sticker-\(UUID().uuidString).mp4"), output = folder.appendingPathComponent("morse-sticker-\(UUID().uuidString).mp4")
    try data.write(to: input, options: [.atomic])
    defer { try? FileManager.default.removeItem(at: input); try? FileManager.default.removeItem(at: output) }
    let asset = AVURLAsset(url: input)
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw HelperFailure.unreadable }
    let transform = try await track.load(.preferredTransform), duration = try await asset.load(.duration)
    let rate = try await track.load(.nominalFrameRate)
    let upright = try await uprightSize(track)
    let area = rect.intersection(CGRect(origin: .zero, size: upright))
    guard !area.isNull, area.width >= 1, duration.seconds > 0 else { throw HelperFailure.failed }
    let composition = AVMutableComposition()
    guard let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw HelperFailure.failed }
    try videoTrack.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: track, at: .zero)
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
    let scale = CGFloat(side) / area.width
    layer.setTransform(transform.concatenating(CGAffineTransform(translationX: -area.minX, y: -area.minY)).concatenating(CGAffineTransform(scaleX: scale, y: scale)), at: .zero)
    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    instruction.layerInstructions = [layer]
    let videoComposition = AVMutableVideoComposition()
    videoComposition.renderSize = CGSize(width: side, height: side)
    videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(min(60, max(1, rate.isFinite && rate > 0 ? rate.rounded() : 30))))
    videoComposition.instructions = [instruction]
    guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else { throw HelperFailure.failed }
    session.videoComposition = videoComposition
    session.shouldOptimizeForNetworkUse = true
    try await session.export(to: output, as: .mp4)
    return try Data(contentsOf: output)
}

final class Recognition: NSObject, SFSpeechRecognitionTaskDelegate, @unchecked Sendable {
    private var continuation: CheckedContinuation<String?, Never>?
    private var best: String?
    func run(_ recognizer: SFSpeechRecognizer, _ request: SFSpeechURLRecognitionRequest) async -> String? {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            recognizer.recognitionTask(with: request, delegate: self)
        }
    }
    func speechRecognitionTask(_ task: SFSpeechRecognitionTask, didFinishRecognition result: SFSpeechRecognitionResult) {
        best = result.bestTranscription.formattedString
    }
    func speechRecognitionTask(_ task: SFSpeechRecognitionTask, didFinishSuccessfully successfully: Bool) {
        let text = successfully ? best : nil
        continuation?.resume(returning: text)
        continuation = nil
    }
}

func authorization() async -> SFSpeechRecognizerAuthorizationStatus {
    let current = SFSpeechRecognizer.authorizationStatus()
    if current != .notDetermined { return current }
    return await withCheckedContinuation { continuation in
        SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
    }
}

func transcribe(_ data: Data, locale: String) async -> [String: Any] {
    guard await authorization() == .authorized else { return ["status": "denied"] }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)) ?? SFSpeechRecognizer(locale: Locale(identifier: "ko-KR")),
          recognizer.isAvailable else { return ["status": "unavailable"] }
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("morse-voice-\(UUID().uuidString).m4a")
    do { try data.write(to: file, options: [.atomic]) } catch { return ["status": "failed"] }
    defer { try? FileManager.default.removeItem(at: file) }
    let request = SFSpeechURLRecognitionRequest(url: file)
    request.shouldReportPartialResults = false
    request.requiresOnDeviceRecognition = false
    let text = await Recognition().run(recognizer, request)
    guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return ["status": "failed"] }
    return ["status": "ok", "text": text]
}

actor Output {
    func send(_ value: [String: Any]) {
        guard var data = try? JSONSerialization.data(withJSONObject: value) else { return }
        data.append(0x0A)
        FileHandle.standardOutput.write(data)
    }
}

@main
struct MorseMedia {
    static func main() async {
        let output = Output()
        do {
            for try await line in FileHandle.standardInput.bytes.lines {
                guard let json = line.data(using: .utf8),
                      let request = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
                      let id = request["id"] as? String, let op = request["op"] as? String else { continue }
                // Video compression names files; every other request carries its bytes (at most 20 MB).
                let data = (request["data"] as? String).flatMap { Data(base64Encoded: $0) } ?? Data()
                guard op == "compress-video" || (!data.isEmpty && data.count <= 20 * 1024 * 1024) else { continue }
                Task {
                    if op == "compress-video" {
                        guard let input = request["input"] as? String, let outputPath = request["output"] as? String, let preset = request["preset"] as? String else {
                            await output.send(["id": id, "status": "failed"]); return
                        }
                        let result = await compressVideo(input: URL(fileURLWithPath: input), output: URL(fileURLWithPath: outputPath), preset: preset, maxSeconds: request["maxSeconds"] as? Double ?? 660,
                                                         start: request["start"] as? Double, end: request["end"] as? Double,
                                                         overlay: (request["overlay"] as? String).map { URL(fileURLWithPath: $0) })
                        await output.send(result.merging(["id": id]) { current, _ in current })
                    } else if op == "crop-gif" || op == "crop-mp4" {
                        let rect = CGRect(x: request["x"] as? Double ?? 0, y: request["y"] as? Double ?? 0, width: request["size"] as? Double ?? 0, height: request["size"] as? Double ?? 0)
                        let side = min(1024, max(64, request["side"] as? Int ?? 512))
                        do {
                            let cropped = op == "crop-gif" ? try cropGIF(data, rect: rect, side: side) : try await cropVideo(data, rect: rect, side: side)
                            await output.send(["id": id, "status": "ok", "data": cropped.base64EncodedString()])
                        } catch { await output.send(["id": id, "status": "failed"]) }
                    } else if op == "cutout" {
                        guard #available(macOS 14.0, *) else { await output.send(["id": id, "status": "unavailable"]); return }
                        do { await output.send(["id": id, "status": "ok", "data": try cutout(data).base64EncodedString()]) }
                        catch HelperFailure.noSubject { await output.send(["id": id, "status": "no-subject"]) }
                        catch { await output.send(["id": id, "status": "failed"]) }
                    } else if op == "transcribe" {
                        let locale = request["locale"] as? String ?? "ko-KR"
                        let result = await transcribe(data, locale: locale)
                        await output.send(result.merging(["id": id]) { current, _ in current })
                    }
                }
            }
        } catch {}
    }
}

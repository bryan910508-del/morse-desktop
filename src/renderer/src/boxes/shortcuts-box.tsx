import { shortcutCommands, shortcutLabel, shortcuts, type ShortcutPlatform } from '../../../shared/shortcuts'
import { controller } from '../app/ui'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

export function showShortcutsBox(platform: ShortcutPlatform): void {
  controller.showLayer(close => <Box title={tr('키보드 단축키')} width={420} onClose={close} buttons={<button className="button flat" data-autofocus onClick={close}>{tr('닫기')}</button>}>
    {([['탐색', tr('탐색')], ['대화', tr('대화')], ['화면', tr('화면')]] as const).map(([group, title]) => <section key={group} className="shortcut-group">
      <h3>{title}</h3>
      {shortcutCommands.filter(command => shortcuts[command].group === group).map(command => <div key={command} className="shortcut-row">
        <span>{shortcuts[command].label}</span><kbd>{shortcutLabel(command, platform)}</kbd>
      </div>)}
    </section>)}
  </Box>)
}

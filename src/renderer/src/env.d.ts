import type { DesktopBridge } from '../../shared/model'
declare global { interface Window { morse: DesktopBridge } }

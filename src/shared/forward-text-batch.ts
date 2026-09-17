// Keep the text-only bridge contract while sharing the same identity bounds.
export { maxForwardMessages as maxForwardTexts, forwardBatchRequest as textForwardBatchRequest } from './forward-batch'
export type { ForwardBatchRequest as TextForwardBatchRequest } from './forward-batch'

/**
 * Serialized page-context helpers, grouped by concern. Each module runs inside the
 * page without module dependencies; this file only re-exports them.
 */
export { inspectPageForms } from './page-form-inspect';
export { fillPageForm } from './page-form-fill';
export { findPageElements, getPageFocusedElement, getElementBoundingBox } from './page-find';
export { captureFormCheckpoint, restoreFormCheckpoint } from './page-checkpoint';

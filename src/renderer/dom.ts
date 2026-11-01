/** Small DOM helpers shared by the renderer modules. */
export function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing element: ${id}`);
  return result as T;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string, durationMs = 3500): void {
  const toast = element('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, durationMs);
}

export function showError(message: string): void {
  showToast(message, 6000);
}

/** Lives outside React so it is visible before the JavaScript bundle boots. */
export function setStartupStatus(message: string): void {
  const status = document.getElementById('startup-status');
  if (status) status.textContent = message;
}

export function dismissStartupLoader(): void {
  document.getElementById('startup-loader')?.remove();
}

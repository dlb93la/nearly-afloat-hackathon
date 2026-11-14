import './profile-progress.css';

export function mountProfileProgress() {
  const get = id => document.getElementById(id);
  const button = get('profile-progress');
  const dialog = get('profile-dialog');
  const generate = get('profile-generate');
  const restore = get('profile-restore');
  const restoreButton = restore.querySelector('button');
  const code = get('profile-code');
  const output = get('profile-output');
  const outputLabel = get('profile-output-label');
  const status = get('profile-status');

  async function update(path, body) {
    generate.disabled = restoreButton.disabled = true;
    status.hidden = true;
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      return data;
    } catch (error) {
      status.hidden = false;
      status.textContent = error.message || 'Could not reach the profile server.';
      return null;
    } finally {
      generate.disabled = restoreButton.disabled = false;
    }
  }

  button.addEventListener('click', () => {
    if (dialog.open) return;
    output.value = '';
    code.value = '';
    outputLabel.hidden = status.hidden = true;
    dialog.showModal();
  });
  generate.addEventListener('click', async () => {
    const result = await update('/progress-code');
    if (!result || !dialog.open) return;
    output.value = result.code;
    outputLabel.hidden = false;
    status.hidden = false;
    status.textContent = 'Save this code privately. Creating a new code replaces the old one.';
    output.select();
  });
  restore.addEventListener('submit', async event => {
    event.preventDefault();
    if (await update('/restore-progress', JSON.stringify({ code: code.value.trim() }))) location.reload();
  });

  return connected => { button.hidden = !connected; };
}

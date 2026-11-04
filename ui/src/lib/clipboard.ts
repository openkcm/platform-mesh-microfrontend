export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyThroughSelection(text);
  }
};

// The portal frame may not be allowed to use the Clipboard API.
const copyThroughSelection = (text: string): boolean => {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand('copy');
  } finally {
    field.remove();
  }
};

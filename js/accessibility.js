
import { els } from './config.js';

const A11Y_KEY = { FONT: 'wc26_fontScale', CONTRAST: 'wc26_highContrast' };
const FONT_SCALE_LABELS = { '-1': 'Pequeño', '0': 'Normal', '1': 'Grande', '2': 'Muy grande' };

function applyFontScale(scale) {
  document.documentElement.classList.remove('font-scale-neg1', 'font-scale-1', 'font-scale-2');
  if (scale === -1) document.documentElement.classList.add('font-scale-neg1');
  if (scale === 1) document.documentElement.classList.add('font-scale-1');
  if (scale === 2) document.documentElement.classList.add('font-scale-2');
  localStorage.setItem(A11Y_KEY.FONT, String(scale));
 
  if (els.fontSizeLabel) els.fontSizeLabel.textContent = `Tamaño: ${FONT_SCALE_LABELS[String(scale)]}`;
}

function applyContrast(enabled) {
  document.documentElement.classList.toggle('high-contrast', enabled);
  els.contrastToggleBtn.setAttribute('aria-pressed', String(enabled));
  localStorage.setItem(A11Y_KEY.CONTRAST, enabled ? '1' : '0');
}

let fontScale = Number(localStorage.getItem(A11Y_KEY.FONT)) || 0;
applyFontScale(fontScale);
applyContrast(localStorage.getItem(A11Y_KEY.CONTRAST) === '1');

els.fontIncreaseBtn.addEventListener('click', () => {
  fontScale = Math.min(2, fontScale + 1);
  applyFontScale(fontScale);
});
els.fontDecreaseBtn.addEventListener('click', () => {
  fontScale = Math.max(-1, fontScale - 1);
  applyFontScale(fontScale);
});
els.contrastToggleBtn.addEventListener('click', () => {
  applyContrast(!document.documentElement.classList.contains('high-contrast'));
});

// ============================================================
// MARCOM — Media / Image Upload  (frontend/js/media.js)
// ============================================================
import { S } from './state.js';

export function handleFile(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const MAX_W = 800, scale = img.width > MAX_W ? MAX_W / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const comp = canvas.toDataURL('image/jpeg', 0.85);
      S.img = { base64: comp.split(',')[1], mediaType: 'image/jpeg', name: file.name };
      // The upload UI was retired alongside the wizard input; guards
      // keep the function safe for any programmatic callers.
      const thumb   = document.getElementById('imgThumb');
      const name    = document.getElementById('imgName');
      const preview = document.getElementById('imgPreview');
      const btn     = document.getElementById('upBtn');
      if (thumb)   thumb.src = comp;
      if (name)    name.textContent = file.name;
      if (preview) preview.style.display = 'flex';
      if (btn)     btn.classList.add('has-img');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file); e.target.value = '';
}

export function clearImg() {
  S.img = null;
  const preview = document.getElementById('imgPreview');
  const btn     = document.getElementById('upBtn');
  if (preview) preview.style.display = 'none';
  if (btn)     btn.classList.remove('has-img');
}

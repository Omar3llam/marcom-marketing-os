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
      document.getElementById('imgThumb').src = comp;
      document.getElementById('imgName').textContent = file.name;
      document.getElementById('imgPreview').style.display = 'flex';
      document.getElementById('upBtn').classList.add('has-img');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file); e.target.value = '';
}

export function clearImg() {
  S.img = null;
  document.getElementById('imgPreview').style.display = 'none';
  document.getElementById('upBtn').classList.remove('has-img');
}

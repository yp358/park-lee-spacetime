// ==========================================================
// THE PUBLIC: Constitutional Scriptorium & Interactive Quill
// ==========================================================

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('quillCanvas');
  const ctx = canvas.getContext('2d');
  const clearBtn = document.getElementById('clearSigBtn');
  const stampBtn = document.getElementById('stampSealBtn');
  const proclaimBtn = document.getElementById('proclaimBtn');
  const waxSeal = document.getElementById('waxSeal');
  const statusNotice = document.getElementById('statusNotice');

  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;
  let lastTime = 0;

  // Initialize canvas styling
  function initCanvas() {
    ctx.strokeStyle = '#1e1610'; // Rich dark iron gall ink
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5;

    // Subtle guidelines
    drawGuidelines();
  }

  function drawGuidelines() {
    ctx.save();
    ctx.strokeStyle = 'rgba(180, 160, 130, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // Baseline
    ctx.beginPath();
    ctx.moveTo(40, 160);
    ctx.lineTo(canvas.width - 40, 160);
    ctx.stroke();

    // Text hint
    ctx.font = 'italic 16px "EB Garamond", serif';
    ctx.fillStyle = 'rgba(120, 100, 80, 0.35)';
    ctx.fillText('✍  Affix your hand & seal here upon the public register...', 50, 145);
    ctx.restore();
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  // Quill ink dynamics (speed-sensitive line thickness)
  function startDrawing(e) {
    e.preventDefault();
    isDrawing = true;
    const pos = getPos(e);
    lastX = pos.x;
    lastY = pos.y;
    lastTime = Date.now();
    playQuillAudio();
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getPos(e);
    const now = Date.now();
    const dt = now - lastTime || 1;
    const dist = Math.hypot(pos.x - lastX, pos.y - lastY);
    const speed = dist / dt;

    // Calligraphic pressure emulation
    let dynamicWidth = Math.max(1.5, Math.min(4.5, 4.0 - speed * 1.5));

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.lineWidth = dynamicWidth;
    ctx.strokeStyle = '#211710';
    ctx.stroke();

    lastX = pos.x;
    lastY = pos.y;
    lastTime = now;
  }

  function stopDrawing(e) {
    if (!isDrawing) return;
    isDrawing = false;
  }

  // Canvas Event Listeners
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseleave', stopDrawing);

  canvas.addEventListener('touchstart', startDrawing, { passive: false });
  canvas.addEventListener('touchmove', draw, { passive: false });
  canvas.addEventListener('touchend', stopDrawing);

  // Clear Signature
  clearBtn.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGuidelines();
    waxSeal.classList.remove('stamped');
    statusNotice.textContent = 'Quill canvas cleansed. Awaiting fresh inscription.';
  });

  // Stamp Wax Seal
  stampBtn.addEventListener('click', () => {
    waxSeal.classList.add('stamped');
    playStampAudio();
    statusNotice.textContent = 'Imperial Wax Seal formally stamped upon the parchment.';
  });

  // Proclaim Constitution
  proclaimBtn.addEventListener('click', () => {
    waxSeal.classList.add('stamped');
    playStampAudio();
    statusNotice.textContent = '✦ IN WITNESS WHEREOF: Your mark is recorded in The Public Annals of Park-Lee Spacetime. ✦';

    try {
      const dataUrl = canvas.toDataURL();
      localStorage.setItem('park_lee_public_signature', dataUrl);
    } catch (err) {
      console.log('Signature local save:', err);
    }
  });

  // Synthesized Web Audio Sound Effects (No external dependencies)
  function playQuillAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800 + Math.random() * 400, ctx.currentTime);
      gain.gain.setValueAtTime(0.008, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch (e) {
      // Audio fallback
    }
  }

  function playStampAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.2);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.26);
    } catch (e) {
      // Audio fallback
    }
  }

  initCanvas();
});

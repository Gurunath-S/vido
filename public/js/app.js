/**
 * VIDO Studio - Main Application Controller
 */
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const video = document.getElementById('studio-video');
  const overlayCanvas = document.getElementById('overlay-canvas');
  const viewportEmpty = document.getElementById('viewport-empty');

  // Source pickers
  const sourceTabs = document.querySelectorAll('.source-tab');
  const localChipsContainer = document.getElementById('local-file-chips');
  const btnRefreshLocal = document.getElementById('btn-refresh-local');
  const inputDirectPath = document.getElementById('input-direct-path');
  const btnLoadPath = document.getElementById('btn-load-path');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const btnBrowseFile = document.getElementById('btn-browse-file');
  const btnLoadDemo = document.getElementById('btn-load-demo');

  // Stage display
  const displayVideoName = document.getElementById('display-video-name');
  const displayVideoRes = document.getElementById('display-video-res');
  const btnToggleBoxes = document.getElementById('btn-toggle-boxes');
  const btnClearBoxes = document.getElementById('btn-clear-boxes');

  // Timeline
  const timelineSlider = document.getElementById('timeline-slider');
  const btnPlayPause = document.getElementById('btn-play-pause');
  const iconPlay = btnPlayPause.querySelector('.icon-play');
  const iconPause = btnPlayPause.querySelector('.icon-pause');
  const btnStepPrevSec = document.getElementById('btn-step-prev-sec');
  const btnStepNextSec = document.getElementById('btn-step-next-sec');
  const readoutCurrent = document.getElementById('readout-current');
  const readoutTotal = document.getElementById('readout-total');
  const btnGeneratePreview = document.getElementById('btn-generate-preview');

  // Comparison
  const compCard = document.getElementById('comparison-card');
  const compContainer = document.getElementById('comp-container');
  const imgBefore = document.getElementById('img-before');
  const imgAfter = document.getElementById('img-after');
  const compAfterLayer = document.getElementById('comp-after-layer');
  const compSliderHandle = document.getElementById('comp-slider-handle');
  const btnCompSplit = document.getElementById('btn-comp-split');
  const btnCompSide = document.getElementById('btn-comp-side');

  // Specs & Deck
  const specResolution = document.getElementById('spec-resolution');
  const specVcodec = document.getElementById('spec-vcodec');
  const specFps = document.getElementById('spec-fps');
  const specDuration = document.getElementById('spec-duration');
  const specAudio = document.getElementById('spec-audio');

  const boxesList = document.getElementById('boxes-list');
  const boxCount = document.getElementById('box-count');
  const btnAddBox = document.getElementById('btn-add-box');

  const algoRadios = document.querySelectorAll('input[name="algorithm"]');
  const precisionControls = document.getElementById('precision-controls');
  const sensSlider = document.getElementById('sens-slider');
  const sensValText = document.getElementById('sens-val-text');
  const dilateSlider = document.getElementById('dilate-slider');
  const dilateValText = document.getElementById('dilate-val-text');
  const blurControls = document.getElementById('blur-controls');
  const blurSlider = document.getElementById('blur-slider');
  const blurValText = document.getElementById('blur-val-text');
  const btnToggleMaskView = document.getElementById('btn-toggle-mask-view');
  const badgeAfterText = document.getElementById('badge-after-text');

  const selectQuality = document.getElementById('select-quality');
  const qualityNote = document.getElementById('quality-note');
  const checkEnableTrim = document.getElementById('check-enable-trim');
  const trimInputs = document.getElementById('trim-inputs');
  const trimStart = document.getElementById('trim-start');
  const trimEnd = document.getElementById('trim-end');
  const btnStartProcess = document.getElementById('btn-start-process');

  // Modal
  const processModal = document.getElementById('process-modal');
  const modalStatusTitle = document.getElementById('modal-status-title');
  const modalStatusSub = document.getElementById('modal-status-sub');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const statPct = document.getElementById('stat-pct');
  const statCurrentTime = document.getElementById('stat-current-time');
  const statTotalTime = document.getElementById('stat-total-time');
  const statSpeed = document.getElementById('stat-speed');
  const statFps = document.getElementById('stat-fps');
  const statQuality = document.getElementById('stat-quality');
  const modalCompletedArea = document.getElementById('modal-completed-area');
  const btnDownloadVideo = document.getElementById('btn-download-video');
  const btnPlayOutput = document.getElementById('btn-play-output');
  const btnCancelJob = document.getElementById('btn-cancel-job');
  const btnCloseModal = document.getElementById('btn-close-modal');

  // Preset chips
  const presetChips = document.querySelectorAll('.preset-chip');

  // App State
  let currentVideoPath = null;
  let currentMetadata = null;
  let activeJobId = null;
  let activeEventSource = null;
  let currentCompMode = 'split';
  let isDraggingSlider = false;
  let isMaskViewActive = false;
  let useFrameFallback = false;

  // Initialize Canvas Overlay Manager
  const canvasOverlay = new VideoCanvasOverlay(overlayCanvas, video);

  canvasOverlay.onBoxesChanged = (boxes) => {
    updateBoxesUI(boxes);
  };

  canvasOverlay.onBoxSelected = (index) => {
    highlightSelectedBox(index);
  };

  // Load Local Files on startup
  loadLocalFiles();

  /* ========================================================================= */
  /* Source Selection & Tabs                                                   */
  /* ========================================================================= */
  sourceTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sourceTabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const paneId = `tab-${tab.dataset.tab}`;
      const pane = document.getElementById(paneId);
      if (pane) pane.classList.add('active');
    });
  });

  async function loadLocalFiles() {
    localChipsContainer.innerHTML = '<span class="loading-hint">Scanning local video folders...</span>';
    try {
      const res = await fetch('/api/local-files');
      const data = await res.json();

      if (!data.files || data.files.length === 0) {
        localChipsContainer.innerHTML = '<span class="loading-hint">No video files found in ~/Videos or ~/Downloads</span>';
        return;
      }

      localChipsContainer.innerHTML = '';
      data.files.forEach(f => {
        const chip = document.createElement('div');
        chip.className = 'video-chip';
        chip.title = f.path;
        chip.innerHTML = `
          <span>${escapeHtml(f.name)}</span>
          <span class="chip-size">${f.sizeFormatted}</span>
        `;
        chip.addEventListener('click', () => {
          document.querySelectorAll('.video-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          loadVideoByPath(f.path);
        });
        localChipsContainer.appendChild(chip);
      });
    } catch (err) {
      localChipsContainer.innerHTML = `<span class="loading-hint">Failed to scan: ${err.message}</span>`;
    }
  }

  btnRefreshLocal.addEventListener('click', loadLocalFiles);

  btnLoadPath.addEventListener('click', () => {
    const p = inputDirectPath.value.trim();
    if (p) loadVideoByPath(p);
  });

  inputDirectPath.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const p = inputDirectPath.value.trim();
      if (p) loadVideoByPath(p);
    }
  });

  // Upload dropzone
  btnBrowseFile.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('click', (e) => {
    if (e.target !== btnBrowseFile) fileInput.click();
  });

  ['dragenter', 'dragover'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) uploadVideoFile(file);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) uploadVideoFile(file);
  });

  async function uploadVideoFile(file) {
    const formData = new FormData();
    formData.append('video', file);

    viewportEmpty.innerHTML = `
      <div class="spinner-ring"></div>
      <h3>Uploading ${escapeHtml(file.name)}...</h3>
      <p>Zero-Loss processing pipeline initializing</p>
    `;

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      loadVideoWithMetadata(data.file.path, data.file.metadata);
    } catch (err) {
      alert(`Upload error: ${err.message}`);
      viewportEmpty.innerHTML = `
        <div class="empty-icon">❌</div>
        <h3>Upload Failed</h3>
        <p>${escapeHtml(err.message)}</p>
      `;
    }
  }

  // Load Demo Video
  btnLoadDemo.addEventListener('click', async () => {
    btnLoadDemo.disabled = true;
    btnLoadDemo.innerHTML = '<span class="spinner-ring" style="width:14px;height:14px;border-width:2px;"></span> Generating 1080p Demo...';

    try {
      const res = await fetch('/api/generate-sample', { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      await loadVideoWithMetadata(data.path, data.metadata);

      // Auto-apply Top Banner preset for demo!
      setTimeout(() => {
        canvasOverlay.clearBoxes();
        canvasOverlay.applyPreset('top-banner');
      }, 500);
    } catch (err) {
      alert(`Demo error: ${err.message}`);
    } finally {
      btnLoadDemo.disabled = false;
      btnLoadDemo.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        Load Demo Clip
      `;
    }
  });

  /* ========================================================================= */
  /* Video Loading & Metadata                                                  */
  /* ========================================================================= */
  async function loadVideoByPath(filePath) {
    try {
      const res = await fetch(`/api/inspect?path=${encodeURIComponent(filePath)}`);
      const meta = await res.json();
      if (meta.error) throw new Error(meta.error);

      loadVideoWithMetadata(filePath, meta);
    } catch (err) {
      alert(`Could not load video: ${err.message}`);
    }
  }

  function loadVideoWithMetadata(filePath, meta) {
    currentVideoPath = filePath;
    currentMetadata = meta;

    displayVideoName.textContent = meta.filename;
    displayVideoRes.textContent = `${meta.video.width} x ${meta.video.height} (${meta.video.fps} fps)`;

    // Update specs
    specResolution.textContent = `${meta.video.width}x${meta.video.height} (${meta.video.aspectRatio || '16:9'})`;
    specVcodec.textContent = `${meta.video.codec?.toUpperCase()} [${meta.video.pixFmt || 'yuv420p'}]`;
    specFps.textContent = `${meta.video.fps} fps`;
    specDuration.textContent = meta.durationFormatted;

    if (meta.audioTracks && meta.audioTracks.length > 0) {
      specAudio.textContent = meta.audioTracks.map(a => `${a.title || a.codec} (${a.language})`).join(' | ');
    } else {
      specAudio.textContent = 'None / Passthrough';
    }

    trimEnd.value = Math.min(60, Math.floor(meta.duration));

    // Configure overlay canvas
    canvasOverlay.setNativeResolution(meta.video.width, meta.video.height);

    // Hide empty placeholder
    viewportEmpty.classList.add('hidden');

    // Stream video
    const streamUrl = `/api/stream?path=${encodeURIComponent(filePath)}`;
    video.src = streamUrl;
    video.load();

    video.onloadedmetadata = () => {
      timelineSlider.max = video.duration || meta.duration;
      readoutTotal.textContent = formatDuration(video.duration || meta.duration);
      canvasOverlay.resizeCanvas();
      btnGeneratePreview.disabled = false;
      btnStartProcess.disabled = false;
    };

    video.onerror = () => {
      // Browser doesn't natively support MKV/HEVC container playback directly in <video> tag
      console.warn('Native video tag decode error, falling back to frame extraction mode');
      useFrameFallback = true;
      loadFallbackFrame(0);
      btnGeneratePreview.disabled = false;
      btnStartProcess.disabled = false;
      timelineSlider.max = meta.duration;
      readoutTotal.textContent = formatDuration(meta.duration);
    };

    readoutTotal.textContent = meta.durationFormatted;
    btnGeneratePreview.disabled = false;
    btnStartProcess.disabled = false;
  }

  async function loadFallbackFrame(time) {
    if (!currentVideoPath) return;
    try {
      const frameUrl = `/api/frame?path=${encodeURIComponent(currentVideoPath)}&time=${time}`;
      video.poster = frameUrl;
      readoutCurrent.textContent = formatDuration(time);
      canvasOverlay.render();
    } catch {}
  }

  /* ========================================================================= */
  /* Timeline & Playback Controls                                              */
  /* ========================================================================= */
  btnPlayPause.addEventListener('click', () => {
    if (video.paused) {
      video.play().catch(() => {});
      iconPlay.classList.add('hidden');
      iconPause.classList.remove('hidden');
    } else {
      video.pause();
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
    }
  });

  video.addEventListener('timeupdate', () => {
    if (!video.seeking) {
      timelineSlider.value = video.currentTime;
      readoutCurrent.textContent = formatDuration(video.currentTime);
    }
  });

  timelineSlider.addEventListener('input', () => {
    const t = parseFloat(timelineSlider.value);
    readoutCurrent.textContent = formatDuration(t);
    if (!useFrameFallback) {
      video.currentTime = t;
    }
  });

  timelineSlider.addEventListener('change', () => {
    const t = parseFloat(timelineSlider.value);
    if (useFrameFallback) {
      loadFallbackFrame(t);
    }
  });

  btnStepPrevSec.addEventListener('click', () => {
    const t = Math.max(0, (video.currentTime || parseFloat(timelineSlider.value)) - 1);
    video.currentTime = t;
    timelineSlider.value = t;
    readoutCurrent.textContent = formatDuration(t);
    if (useFrameFallback) loadFallbackFrame(t);
  });

  btnStepNextSec.addEventListener('click', () => {
    const maxT = currentMetadata?.duration || 100;
    const t = Math.min(maxT, (video.currentTime || parseFloat(timelineSlider.value)) + 1);
    video.currentTime = t;
    timelineSlider.value = t;
    readoutCurrent.textContent = formatDuration(t);
    if (useFrameFallback) loadFallbackFrame(t);
  });

  btnToggleBoxes.addEventListener('click', () => {
    canvasOverlay.toggleVisibility();
    btnToggleBoxes.classList.toggle('active', canvasOverlay.visible);
  });

  btnClearBoxes.addEventListener('click', () => {
    if (confirm('Clear all text removal zones?')) {
      canvasOverlay.clearBoxes();
    }
  });

  /* ========================================================================= */
  /* Presets & Removal Zones UI                                                */
  /* ========================================================================= */
  presetChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const preset = chip.dataset.preset;
      canvasOverlay.applyPreset(preset);
    });
  });

  btnAddBox.addEventListener('click', () => {
    // Add default box in upper region
    const nw = currentMetadata?.video.width || 1920;
    const nh = currentMetadata?.video.height || 1080;
    canvasOverlay.addBox({
      x: Math.round(nw * 0.1),
      y: Math.round(nh * 0.05),
      w: Math.round(nw * 0.8),
      h: Math.round(nh * 0.08),
      algorithm: getSelectedAlgorithm(),
      label: `Zone #${canvasOverlay.boxes.length + 1}`
    });
  });

  function updateBoxesUI(boxes) {
    boxCount.textContent = boxes.length;

    if (boxes.length === 0) {
      boxesList.innerHTML = '<div class="empty-zones-hint">No removal zone drawn yet.<br>Click & drag on the video or pick a quick preset above.</div>';
      return;
    }

    boxesList.innerHTML = '';
    boxes.forEach((b, idx) => {
      const card = document.createElement('div');
      card.className = `box-item-card ${idx === canvasOverlay.selectedIndex ? 'selected' : ''}`;
      card.innerHTML = `
        <div class="box-item-info">
          <span class="box-item-name">${escapeHtml(b.label || `Zone #${idx + 1}`)} (${b.algorithm.toUpperCase()})</span>
          <span class="box-item-coords">X: ${b.x}, Y: ${b.y} | ${b.w}x${b.h}px</span>
        </div>
        <button class="box-item-del" title="Delete Zone">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      `;

      card.addEventListener('click', (e) => {
        if (!e.target.closest('.box-item-del')) {
          canvasOverlay.selectedIndex = idx;
          canvasOverlay.render();
          highlightSelectedBox(idx);
        }
      });

      card.querySelector('.box-item-del').addEventListener('click', (e) => {
        e.stopPropagation();
        canvasOverlay.removeBox(idx);
      });

      boxesList.appendChild(card);
    });
  }

  function highlightSelectedBox(index) {
    const cards = boxesList.querySelectorAll('.box-item-card');
    cards.forEach((c, i) => {
      c.classList.toggle('selected', i === index);
    });
  }

  function getSelectedAlgorithm() {
    const checked = document.querySelector('input[name="algorithm"]:checked');
    return checked ? checked.value : 'precision_inpaint';
  }

  algoRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('.algo-radio').forEach(r => r.classList.remove('active'));
      radio.closest('.algo-radio').classList.add('active');

      const algo = radio.value;
      if (['precision_inpaint', 'seamless_clone', 'directional'].includes(algo)) {
        precisionControls.classList.remove('hidden');
        blurControls.classList.add('hidden');
      } else if (algo === 'blur') {
        blurControls.classList.remove('hidden');
        precisionControls.classList.add('hidden');
      } else {
        precisionControls.classList.add('hidden');
        blurControls.classList.add('hidden');
      }

      // Update currently selected box if any
      if (canvasOverlay.selectedIndex >= 0 && canvasOverlay.boxes[canvasOverlay.selectedIndex]) {
        canvasOverlay.boxes[canvasOverlay.selectedIndex].algorithm = algo;
        canvasOverlay.notifyChange();
        canvasOverlay.render();
      }
    });
  });

  sensSlider.addEventListener('input', () => {
    sensValText.textContent = `${sensSlider.value}%`;
  });

  dilateSlider.addEventListener('input', () => {
    dilateValText.textContent = `${dilateSlider.value}px`;
  });

  blurSlider.addEventListener('input', () => {
    blurValText.textContent = `${blurSlider.value}px`;
  });

  // Mask Preview Toggle
  btnToggleMaskView.addEventListener('click', () => {
    isMaskViewActive = !isMaskViewActive;
    btnToggleMaskView.classList.toggle('active', isMaskViewActive);
    if (isMaskViewActive) {
      btnToggleMaskView.textContent = 'Hide Text Mask';
      badgeAfterText.textContent = 'TEXT MASK (CYAN HIGHLIGHT)';
      badgeAfterText.style.background = 'rgba(6, 182, 212, 0.9)';
    } else {
      btnToggleMaskView.textContent = 'Show Text Mask';
      badgeAfterText.textContent = 'AFTER (TEXT REMOVED)';
      badgeAfterText.style.background = 'rgba(16, 185, 129, 0.85)';
    }
    // Re-generate preview with mask mode
    btnGeneratePreview.click();
  });

  // Quality selection description
  selectQuality.addEventListener('change', () => {
    const val = selectQuality.value;
    if (val === 'visually-lossless') {
      qualityNote.textContent = 'CRF 14 is visually indistinguishable from source master with zero visible compression artifacts.';
    } else if (val === 'lossless') {
      qualityNote.textContent = 'CRF 0 preserves 100% bit-exact pixel math outside the text removal area (Larger file size).';
    } else {
      qualityNote.textContent = 'CRF 18 delivers fast high-definition encoding with great quality.';
    }
  });

  checkEnableTrim.addEventListener('change', () => {
    trimInputs.classList.toggle('hidden', !checkEnableTrim.checked);
  });

  /* ========================================================================= */
  /* Live Before & After Inspector                                             */
  /* ========================================================================= */
  btnGeneratePreview.addEventListener('click', async () => {
    if (!currentVideoPath) return;

    const boxes = canvasOverlay.getBoxes();
    if (boxes.length === 0) {
      alert('Please draw at least one text removal zone or click a Quick Preset first!');
      return;
    }

    const timestamp = video.currentTime || parseFloat(timelineSlider.value) || 0;
    const globalAlgorithm = getSelectedAlgorithm();
    const blurSigma = parseInt(blurSlider.value, 10) || 12;
    const sensitivity = parseInt(sensSlider.value, 10) || 65;
    const dilation = parseInt(dilateSlider.value, 10) || 3;

    btnGeneratePreview.disabled = true;
    btnGeneratePreview.innerHTML = '<span class="spinner-ring" style="width:14px;height:14px;border-width:2px;"></span> Rendering Frame...';

    try {
      const res = await fetch('/api/preview-filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: currentVideoPath,
          timestamp,
          boxes,
          globalAlgorithm,
          blurSigma,
          sensitivity,
          dilation,
          previewMask: isMaskViewActive
        })
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Populate Before & After images
      imgBefore.onload = () => {
        const compVp = document.getElementById('comparison-viewport');
        if (compVp && imgBefore.naturalWidth && imgBefore.naturalHeight) {
          compVp.style.aspectRatio = `${imgBefore.naturalWidth} / ${imgBefore.naturalHeight}`;
          compVp.style.maxHeight = '75vh';
        }
      };

      imgBefore.src = data.originalUrl;
      imgAfter.src = data.filteredUrl;

      // Reset split position cleanly to 50%
      compAfterLayer.style.clipPath = 'inset(0 0 0 50%)';
      compSliderHandle.style.left = '50%';

      // Scroll smoothly to inspector if not fully in view
      compCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      alert(`Preview failed: ${err.message}`);
    } finally {
      btnGeneratePreview.disabled = false;
      btnGeneratePreview.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        Compare Before / After
      `;
    }
  });

  // Smooth Split Slider Interaction (Mouse + Touch anywhere on comparison container)
  function updateSplitSlider(clientX) {
    if (currentCompMode !== 'split') return;
    const rect = compContainer.getBoundingClientRect();
    if (rect.width === 0) return;
    let pct = ((clientX - rect.left) / rect.width) * 100;
    pct = Math.max(0, Math.min(100, pct));

    compAfterLayer.style.clipPath = `inset(0 0 0 ${pct}%)`;
    compSliderHandle.style.left = `${pct}%`;
  }

  compContainer.addEventListener('mousedown', (e) => {
    isDraggingSlider = true;
    updateSplitSlider(e.clientX);
  });
  window.addEventListener('mouseup', () => isDraggingSlider = false);
  window.addEventListener('mousemove', (e) => {
    if (isDraggingSlider) updateSplitSlider(e.clientX);
  });

  compContainer.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length > 0) {
      isDraggingSlider = true;
      updateSplitSlider(e.touches[0].clientX);
    }
  }, { passive: true });
  window.addEventListener('touchend', () => isDraggingSlider = false);
  window.addEventListener('touchmove', (e) => {
    if (isDraggingSlider && e.touches && e.touches.length > 0) {
      updateSplitSlider(e.touches[0].clientX);
    }
  }, { passive: true });

  // Mode toggles
  btnCompSplit.addEventListener('click', () => {
    currentCompMode = 'split';
    btnCompSplit.classList.add('active');
    btnCompSide.classList.remove('active');
    compContainer.className = 'comp-container split-mode';
    compAfterLayer.style.clipPath = 'inset(0 0 0 50%)';
    compSliderHandle.style.left = '50%';
  });

  btnCompSide.addEventListener('click', () => {
    currentCompMode = 'side';
    btnCompSide.classList.add('active');
    btnCompSplit.classList.remove('active');
    compContainer.className = 'comp-container side-mode';
  });

  /* ========================================================================= */
  /* Full Video Text Removal Job Execution                                     */
  /* ========================================================================= */
  btnStartProcess.addEventListener('click', async () => {
    if (!currentVideoPath) return;

    const boxes = canvasOverlay.getBoxes();
    if (boxes.length === 0) {
      alert('Please select at least one text removal bounding box first!');
      return;
    }

    const qualityMode = selectQuality.value;
    const globalAlgorithm = getSelectedAlgorithm();
    const blurSigma = parseInt(blurSlider.value, 10) || 12;
    const sensitivity = parseInt(sensSlider.value, 10) || 65;
    const dilation = parseInt(dilateSlider.value, 10) || 3;

    let startTime = null;
    let endTime = null;
    if (checkEnableTrim.checked) {
      startTime = parseFloat(trimStart.value) || 0;
      endTime = parseFloat(trimEnd.value) || null;
    }

    // Open modal
    processModal.classList.remove('hidden');
    modalStatusTitle.textContent = 'Starting Zero-Loss Encoding...';
    modalStatusSub.textContent = 'Configuring FFmpeg filtergraph & stream mapping';
    progressBarFill.style.width = '0%';
    statPct.textContent = '0.0%';
    modalCompletedArea.classList.add('hidden');
    btnCancelJob.classList.remove('hidden');
    btnCloseModal.classList.add('hidden');
    statQuality.textContent = qualityMode === 'lossless' ? 'CRF 0' : qualityMode === 'visually-lossless' ? 'CRF 14' : 'CRF 18';

    try {
      const res = await fetch('/api/process-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: currentVideoPath,
          boxes,
          globalAlgorithm,
          blurSigma,
          sensitivity,
          dilation,
          qualityMode,
          startTime,
          endTime
        })
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      activeJobId = data.jobId;
      modalStatusTitle.textContent = 'Removing Overlaid Text...';
      modalStatusSub.textContent = `Saving master output to ${data.outputFilename}`;

      // Connect to SSE status stream
      connectJobStatus(activeJobId);
    } catch (err) {
      alert(`Could not start processing: ${err.message}`);
      processModal.classList.add('hidden');
    }
  });

  function connectJobStatus(jobId) {
    if (activeEventSource) {
      activeEventSource.close();
    }

    activeEventSource = new EventSource(`/api/job-status/${jobId}`);

    activeEventSource.onmessage = (e) => {
      const job = JSON.parse(e.data);

      const pct = job.progress || 0;
      progressBarFill.style.width = `${pct}%`;
      statPct.textContent = `${pct.toFixed(1)}%`;

      statCurrentTime.textContent = job.currentTimeFormatted || '00:00:00';
      statTotalTime.textContent = job.totalDurationFormatted || '00:00:00';
      statSpeed.textContent = job.speed || '0.0x';
      statFps.textContent = `${job.fps || 0} fps`;

      if (job.status === 'completed') {
        modalStatusTitle.textContent = 'Video Text Removal Complete!';
        modalStatusSub.textContent = `Output size: ${job.outputSize || 'Clean file ready'}`;
        progressBarFill.style.width = '100%';
        statPct.textContent = '100%';

        modalCompletedArea.classList.remove('hidden');
        btnCancelJob.classList.add('hidden');
        btnCloseModal.classList.remove('hidden');

        btnDownloadVideo.href = job.downloadUrl;
        btnDownloadVideo.download = job.outputFilename;

        btnPlayOutput.onclick = () => {
          processModal.classList.add('hidden');
          const videoTarget = job.outputPath || job.downloadUrl;
          loadVideoByPath(videoTarget);
          canvasOverlay.clearBoxes();
          setTimeout(() => {
            video.play().catch(e => console.log('Autoplay handled:', e));
          }, 350);
        };

        activeEventSource.close();
      } else if (job.status === 'failed' || job.status === 'cancelled') {
        modalStatusTitle.textContent = job.status === 'cancelled' ? 'Job Cancelled' : 'Processing Failed';
        modalStatusSub.textContent = job.error || 'Operation stopped';
        btnCancelJob.classList.add('hidden');
        btnCloseModal.classList.remove('hidden');
        activeEventSource.close();
      }
    };

    activeEventSource.onerror = () => {
      console.warn('SSE connection closed or lost');
    };
  }

  btnCancelJob.addEventListener('click', async () => {
    if (!activeJobId) return;
    try {
      await fetch(`/api/cancel-job/${activeJobId}`, { method: 'POST' });
    } catch {}
  });

  btnCloseModal.addEventListener('click', () => {
    processModal.classList.add('hidden');
  });

  function formatDuration(sec) {
    const s = Math.floor(sec || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const remSec = s % 60;
    return `${h > 0 ? `${h.toString().padStart(2, '0')}:` : ''}${m.toString().padStart(2, '0')}:${remSec.toString().padStart(2, '0')}`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});

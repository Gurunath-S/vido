/**
 * VIDO Studio - Interactive Canvas Overlay Manager
 * Handles responsive bounding box drawing, moving, resizing, and coordinate mapping.
 */
class VideoCanvasOverlay {
  constructor(canvasElement, videoElement) {
    this.canvas = canvasElement;
    this.video = videoElement;
    this.ctx = canvasElement.getContext('2d');

    this.boxes = []; // [{ id, x, y, w, h, algorithm, label }]
    this.selectedIndex = -1;
    this.hoverIndex = -1;
    this.hoverHandle = null; // 'nw', 'ne', 'se', 'sw', 'move', 'delete'

    // Interaction states
    this.isDrawing = false;
    this.isDragging = false;
    this.isResizing = false;
    this.dragStart = { x: 0, y: 0 };
    this.dragHandle = null;
    this.currentBoxSnapshot = null;

    this.visible = true;
    this.nativeWidth = 1920;
    this.nativeHeight = 1080;

    // Callbacks
    this.onBoxesChanged = null;
    this.onBoxSelected = null;

    this.initEvents();
  }

  setNativeResolution(width, height) {
    this.nativeWidth = width || 1920;
    this.nativeHeight = height || 1080;
    this.resizeCanvas();
  }

  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.render();
  }

  /**
   * Calculate video's actual displayed rect inside the letterbox/contain wrapper
   */
  getVideoRenderRect() {
    const canvasRect = this.canvas.getBoundingClientRect();
    const cw = canvasRect.width;
    const ch = canvasRect.height;

    const videoRatio = this.nativeWidth / this.nativeHeight;
    const canvasRatio = cw / ch;

    let rw, rh, rx, ry;

    if (canvasRatio > videoRatio) {
      // Pillarbox (bars on left/right)
      rh = ch;
      rw = ch * videoRatio;
      rx = (cw - rw) / 2;
      ry = 0;
    } else {
      // Letterbox (bars on top/bottom)
      rw = cw;
      rh = cw / videoRatio;
      rx = 0;
      ry = (ch - rh) / 2;
    }

    return { x: rx, y: ry, width: rw, height: rh, scaleX: rw / this.nativeWidth, scaleY: rh / this.nativeHeight };
  }

  /**
   * Convert client display coordinate to video native pixel coordinate
   */
  clientToNative(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const vRect = this.getVideoRenderRect();

    const mouseX = clientX - rect.left - vRect.x;
    const mouseY = clientY - rect.top - vRect.y;

    const nativeX = Math.round(mouseX / vRect.scaleX);
    const nativeY = Math.round(mouseY / vRect.scaleY);

    return {
      x: Math.max(0, Math.min(this.nativeWidth, nativeX)),
      y: Math.max(0, Math.min(this.nativeHeight, nativeY))
    };
  }

  /**
   * Convert video native pixel coordinate to canvas display coordinate
   */
  nativeToDisplay(nativeX, nativeY) {
    const vRect = this.getVideoRenderRect();
    return {
      x: vRect.x + (nativeX * vRect.scaleX),
      y: vRect.y + (nativeY * vRect.scaleY)
    };
  }

  initEvents() {
    window.addEventListener('resize', () => this.resizeCanvas());

    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    window.addEventListener('mouseup', (e) => this.handleMouseUp(e));

    // Touch support
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.handleMouseDown(e.touches[0]);
      }
    });
    window.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        this.handleMouseMove(e.touches[0]);
      }
    });
    window.addEventListener('touchend', (e) => this.handleMouseUp(e));
  }

  handleMouseDown(e) {
    if (!this.visible) return;
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const hit = this.hitTest(mouseX, mouseY);

    if (hit) {
      this.selectedIndex = hit.index;
      if (hit.handle === 'delete') {
        this.removeBox(hit.index);
        return;
      }

      this.currentBoxSnapshot = { ...this.boxes[hit.index] };
      this.dragStart = { x: mouseX, y: mouseY };

      if (hit.handle === 'move') {
        this.isDragging = true;
      } else {
        this.isResizing = true;
        this.dragHandle = hit.handle;
      }

      if (this.onBoxSelected) this.onBoxSelected(this.selectedIndex);
      this.render();
    } else {
      // Start drawing new box
      const nativePt = this.clientToNative(e.clientX, e.clientY);
      this.isDrawing = true;
      this.dragStart = { ...nativePt };

      const newBox = {
        id: `zone_${Date.now()}`,
        x: nativePt.x,
        y: nativePt.y,
        w: 0,
        h: 0,
        algorithm: 'delogo',
        label: `Zone #${this.boxes.length + 1}`
      };

      this.boxes.push(newBox);
      this.selectedIndex = this.boxes.length - 1;
      this.render();
    }
  }

  handleMouseMove(e) {
    if (!this.visible) return;
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (this.isDrawing) {
      const nativePt = this.clientToNative(e.clientX, e.clientY);
      const activeBox = this.boxes[this.selectedIndex];

      const x = Math.min(this.dragStart.x, nativePt.x);
      const y = Math.min(this.dragStart.y, nativePt.y);
      const w = Math.abs(nativePt.x - this.dragStart.x);
      const h = Math.abs(nativePt.y - this.dragStart.y);

      activeBox.x = x;
      activeBox.y = y;
      activeBox.w = w;
      activeBox.h = h;

      this.render();
      return;
    }

    if (this.isDragging && this.selectedIndex >= 0) {
      const vRect = this.getVideoRenderRect();
      const deltaX = (mouseX - this.dragStart.x) / vRect.scaleX;
      const deltaY = (mouseY - this.dragStart.y) / vRect.scaleY;

      const activeBox = this.boxes[this.selectedIndex];
      let newX = Math.round(this.currentBoxSnapshot.x + deltaX);
      let newY = Math.round(this.currentBoxSnapshot.y + deltaY);

      // Clamp within native bounds
      newX = Math.max(0, Math.min(this.nativeWidth - activeBox.w, newX));
      newY = Math.max(0, Math.min(this.nativeHeight - activeBox.h, newY));

      activeBox.x = newX;
      activeBox.y = newY;

      this.render();
      return;
    }

    if (this.isResizing && this.selectedIndex >= 0) {
      const nativePt = this.clientToNative(e.clientX, e.clientY);
      const activeBox = this.boxes[this.selectedIndex];
      const snap = this.currentBoxSnapshot;

      if (this.dragHandle === 'se') {
        activeBox.w = Math.max(20, Math.min(this.nativeWidth - snap.x, nativePt.x - snap.x));
        activeBox.h = Math.max(20, Math.min(this.nativeHeight - snap.y, nativePt.y - snap.y));
      } else if (this.dragHandle === 'nw') {
        const right = snap.x + snap.w;
        const bottom = snap.y + snap.h;
        activeBox.x = Math.max(0, Math.min(right - 20, nativePt.x));
        activeBox.y = Math.max(0, Math.min(bottom - 20, nativePt.y));
        activeBox.w = right - activeBox.x;
        activeBox.h = bottom - activeBox.y;
      } else if (this.dragHandle === 'ne') {
        const bottom = snap.y + snap.h;
        activeBox.y = Math.max(0, Math.min(bottom - 20, nativePt.y));
        activeBox.w = Math.max(20, Math.min(this.nativeWidth - snap.x, nativePt.x - snap.x));
        activeBox.h = bottom - activeBox.y;
      } else if (this.dragHandle === 'sw') {
        const right = snap.x + snap.w;
        activeBox.x = Math.max(0, Math.min(right - 20, nativePt.x));
        activeBox.w = right - activeBox.x;
        activeBox.h = Math.max(20, Math.min(this.nativeHeight - snap.y, nativePt.y - snap.y));
      }

      this.render();
      return;
    }

    // Cursor hover update
    const hit = this.hitTest(mouseX, mouseY);
    if (hit) {
      if (hit.handle === 'delete') this.canvas.style.cursor = 'pointer';
      else if (hit.handle === 'move') this.canvas.style.cursor = 'move';
      else if (hit.handle === 'nw' || hit.handle === 'se') this.canvas.style.cursor = 'nwse-resize';
      else if (hit.handle === 'ne' || hit.handle === 'sw') this.canvas.style.cursor = 'nesw-resize';
    } else {
      this.canvas.style.cursor = 'crosshair';
    }
  }

  handleMouseUp() {
    if (this.isDrawing) {
      this.isDrawing = false;
      const activeBox = this.boxes[this.selectedIndex];
      // Discard tiny clicks
      if (activeBox.w < 15 || activeBox.h < 15) {
        this.boxes.splice(this.selectedIndex, 1);
        this.selectedIndex = -1;
      } else {
        this.notifyChange();
      }
      this.render();
      return;
    }

    if (this.isDragging || this.isResizing) {
      this.isDragging = false;
      this.isResizing = false;
      this.dragHandle = null;
      this.currentBoxSnapshot = null;
      this.notifyChange();
      this.render();
    }
  }

  hitTest(mouseX, mouseY) {
    const handleSize = 8;
    const vRect = this.getVideoRenderRect();

    // Check in reverse order (topmost box first)
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const b = this.boxes[i];
      const p1 = this.nativeToDisplay(b.x, b.y);
      const w = b.w * vRect.scaleX;
      const h = b.h * vRect.scaleY;

      // Check delete button (top right corner + offset)
      const delX = p1.x + w - 10;
      const delY = p1.y - 12;
      if (Math.hypot(mouseX - delX, mouseY - delY) < 12) {
        return { index: i, handle: 'delete' };
      }

      // Check corner handles
      const corners = [
        { handle: 'nw', x: p1.x, y: p1.y },
        { handle: 'ne', x: p1.x + w, y: p1.y },
        { handle: 'se', x: p1.x + w, y: p1.y + h },
        { handle: 'sw', x: p1.x, y: p1.y + h }
      ];

      for (const c of corners) {
        if (Math.abs(mouseX - c.x) <= handleSize && Math.abs(mouseY - c.y) <= handleSize) {
          return { index: i, handle: c.handle };
        }
      }

      // Check inside box body
      if (mouseX >= p1.x && mouseX <= p1.x + w && mouseY >= p1.y && mouseY <= p1.y + h) {
        return { index: i, handle: 'move' };
      }
    }

    return null;
  }

  notifyChange() {
    if (this.onBoxesChanged) {
      this.onBoxesChanged([...this.boxes]);
    }
  }

  addBox(box) {
    this.boxes.push({
      id: box.id || `zone_${Date.now()}`,
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.round(box.w),
      h: Math.round(box.h),
      algorithm: box.algorithm || 'delogo',
      label: box.label || `Zone #${this.boxes.length + 1}`
    });
    this.selectedIndex = this.boxes.length - 1;
    this.notifyChange();
    this.render();
  }

  removeBox(index) {
    if (index >= 0 && index < this.boxes.length) {
      this.boxes.splice(index, 1);
      if (this.selectedIndex === index) this.selectedIndex = -1;
      else if (this.selectedIndex > index) this.selectedIndex -= 1;
      this.notifyChange();
      this.render();
    }
  }

  clearBoxes() {
    this.boxes = [];
    this.selectedIndex = -1;
    this.notifyChange();
    this.render();
  }

  getBoxes() {
    return [...this.boxes];
  }

  toggleVisibility(visible) {
    this.visible = visible !== undefined ? visible : !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.render();
  }

  /**
   * Apply Quick Preset Watermark Zone
   */
  applyPreset(presetType) {
    const nw = this.nativeWidth;
    const nh = this.nativeHeight;

    let box = null;

    if (presetType === 'top-banner') {
      // Wide banner at top
      box = {
        x: Math.round(nw * 0.05),
        y: Math.round(nh * 0.02),
        w: Math.round(nw * 0.90),
        h: Math.round(nh * 0.10),
        algorithm: 'delogo',
        label: 'Top Banner Strip'
      };
    } else if (presetType === 'top-left') {
      box = {
        x: Math.round(nw * 0.03),
        y: Math.round(nh * 0.03),
        w: Math.round(nw * 0.22),
        h: Math.round(nh * 0.08),
        algorithm: 'delogo',
        label: 'Top-Left Watermark'
      };
    } else if (presetType === 'top-right') {
      box = {
        x: Math.round(nw * 0.75),
        y: Math.round(nh * 0.03),
        w: Math.round(nw * 0.22),
        h: Math.round(nh * 0.08),
        algorithm: 'delogo',
        label: 'Top-Right Watermark'
      };
    } else if (presetType === 'cinema-top') {
      box = {
        x: 0,
        y: 0,
        w: nw,
        h: Math.round(nh * 0.125), // Standard ~135px on 1080p
        algorithm: 'letterbox',
        label: 'Cinema Top Black Bar'
      };
    } else if (presetType === 'cinema-bottom') {
      const barH = Math.round(nh * 0.125);
      box = {
        x: 0,
        y: nh - barH,
        w: nw,
        h: barH,
        algorithm: 'letterbox',
        label: 'Cinema Bottom Black Bar'
      };
    } else if (presetType === 'crop-bottom') {
      const cropH = Math.round(nh * 0.20);
      box = {
        x: 0,
        y: nh - cropH,
        w: nw,
        h: cropH,
        algorithm: 'crop',
        label: '✂️ Clean Crop (Zero Blur)'
      };
    } else if (presetType === 'seamless-clone') {
      box = {
        x: Math.round(nw * 0.25),
        y: Math.round(nh * 0.78),
        w: Math.round(nw * 0.40),
        h: Math.round(nh * 0.08),
        algorithm: 'seamless_clone',
        label: '🎨 Seamless Texture Clone'
      };
    } else if (presetType === 'directional') {
      box = {
        x: Math.round(nw * 0.25),
        y: Math.round(nh * 0.78),
        w: Math.round(nw * 0.40),
        h: Math.round(nh * 0.08),
        algorithm: 'directional',
        label: '↔️ Directional Scanline'
      };
    } else if (presetType === 'subtitle-strip') {
      box = {
        x: Math.round(nw * 0.15),
        y: Math.round(nh * 0.84),
        w: Math.round(nw * 0.70),
        h: Math.round(nh * 0.12),
        algorithm: 'precision_inpaint',
        label: 'Subtitle Eradication'
      };
    }

    if (box) {
      this.addBox(box);
    }
  }

  render() {
    const rect = this.canvas.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;

    this.ctx.clearRect(0, 0, cw, ch);
    if (!this.visible) return;

    const vRect = this.getVideoRenderRect();

    // Render each box
    this.boxes.forEach((b, idx) => {
      const isSelected = idx === this.selectedIndex;
      const p = this.nativeToDisplay(b.x, b.y);
      const w = b.w * vRect.scaleX;
      const h = b.h * vRect.scaleY;

      // Color scheme based on algorithm
      let primaryColor = '#06b6d4'; // Cyan (Precision Inpaint)
      let fillColor = 'rgba(6, 182, 212, 0.15)';

      if (b.algorithm === 'crop') {
        primaryColor = '#10b981'; // Emerald Green
        fillColor = 'rgba(16, 185, 129, 0.2)';
      } else if (b.algorithm === 'seamless_clone') {
        primaryColor = '#ec4899'; // Pink
        fillColor = 'rgba(236, 72, 153, 0.2)';
      } else if (b.algorithm === 'directional') {
        primaryColor = '#f59e0b'; // Amber
        fillColor = 'rgba(245, 158, 11, 0.2)';
      } else if (b.algorithm === 'letterbox') {
        primaryColor = '#a855f7'; // Purple
        fillColor = 'rgba(168, 85, 247, 0.2)';
      } else if (b.algorithm === 'blur') {
        primaryColor = '#3b82f6'; // Blue
        fillColor = 'rgba(59, 130, 246, 0.2)';
      }

      if (isSelected) {
        primaryColor = '#6366f1'; // Indigo for selected
        fillColor = 'rgba(99, 102, 241, 0.25)';
      }

      // Box body fill
      this.ctx.fillStyle = fillColor;
      this.ctx.fillRect(p.x, p.y, w, h);

      // Border
      this.ctx.strokeStyle = primaryColor;
      this.ctx.lineWidth = isSelected ? 2.5 : 1.5;
      this.ctx.setLineDash(isSelected ? [6, 4] : []);
      this.ctx.strokeRect(p.x, p.y, w, h);
      this.ctx.setLineDash([]);

      // Label & coordinate pill
      const labelText = `${b.label || `Zone #${idx + 1}`} (${b.w}x${b.h})`;
      this.ctx.font = '600 11px Inter, sans-serif';
      const textMetrics = this.ctx.measureText(labelText);
      const pillW = textMetrics.width + 14;
      const pillH = 20;

      this.ctx.fillStyle = primaryColor;
      this.ctx.beginPath();
      this.ctx.roundRect(p.x, Math.max(0, p.y - 22), pillW, pillH, 4);
      this.ctx.fill();

      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillText(labelText, p.x + 7, Math.max(14, p.y - 8));

      // Close / Delete handle badge
      const delX = p.x + w;
      const delY = p.y;
      this.ctx.fillStyle = '#f43f5e';
      this.ctx.beginPath();
      this.ctx.arc(delX, delY, 8, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 1.8;
      this.ctx.beginPath();
      this.ctx.moveTo(delX - 3.5, delY - 3.5);
      this.ctx.lineTo(delX + 3.5, delY + 3.5);
      this.ctx.moveTo(delX + 3.5, delY - 3.5);
      this.ctx.lineTo(delX - 3.5, delY + 3.5);
      this.ctx.stroke();

      // Corner handles if selected
      if (isSelected) {
        const handleSize = 7;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.strokeStyle = primaryColor;
        this.ctx.lineWidth = 2;

        const corners = [
          { x: p.x, y: p.y },
          { x: p.x + w, y: p.y },
          { x: p.x + w, y: p.y + h },
          { x: p.x, y: p.y + h }
        ];

        corners.forEach(c => {
          this.ctx.beginPath();
          this.ctx.arc(c.x, c.y, handleSize / 2, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.stroke();
        });
      }
    });
  }
}

// Export for app.js
window.VideoCanvasOverlay = VideoCanvasOverlay;

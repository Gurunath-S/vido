#!/usr/bin/env python3
"""
VIDO Advanced Inpainting & Text Removal Engine
Zero-Loss text, watermark, and subtitle eradication using:
- Precision Stroke Inpainting (Navier-Stokes edge-preserving, zero box blur)
- Seamless Patch Cloning (Poisson synthesis using clean adjacent fabric/texture)
- Directional Scanline Interpolation (Zero vertical smudge across color boundaries)
- Smart Lossless Border Crop (100% untouched native video quality)
"""

import sys
import os
import json
import argparse
import cv2
import numpy as np

def create_text_mask(roi, sensitivity=60, dilation=2):
    """
    Generate a precise character-level mask inside a Region of Interest (ROI).
    sensitivity: 10 to 100 (higher = captures colored text, dark outlines, drop shadows)
    dilation: 1 to 6 (expands mask to seamlessly cover antialiased borders)
    """
    if roi.size == 0:
        return np.zeros((1, 1), dtype=np.uint8)

    h, w = roi.shape[:2]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    
    sens_factor = np.clip(sensitivity / 50.0, 0.2, 2.5)
    
    # 1. Morphological Gradient (detects sharp character boundaries and font outlines)
    kernel_grad = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    grad = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, kernel_grad)
    grad_thresh = max(5, int(18 / sens_factor))
    _, mask_grad = cv2.threshold(grad, grad_thresh, 255, cv2.THRESH_BINARY)
    
    # 2. Local Contrast Difference (diff from local background Gaussian/Bilateral)
    smooth = cv2.bilateralFilter(gray, 7, 50, 50)
    diff = cv2.absdiff(gray, smooth)
    diff_thresh = max(5, int(14 / sens_factor))
    _, mask_diff = cv2.threshold(diff, diff_thresh, 255, cv2.THRESH_BINARY)
    
    # 3. Bright/White & High-Luminance Text
    lum_thresh = max(110, int(220 - (sensitivity * 0.9)))
    _, mask_bright = cv2.threshold(gray, lum_thresh, 255, cv2.THRESH_BINARY)
    
    # 4. Vibrant & Saturated Colored Text (Yellow, Neon Green, Red, Cyan subtitles/logos)
    sat = hsv[:, :, 1]
    val = hsv[:, :, 2]
    sat_thresh = max(35, int(90 / sens_factor))
    val_thresh = max(35, int(80 / sens_factor))
    _, mask_sat = cv2.threshold(sat, sat_thresh, 255, cv2.THRESH_BINARY)
    _, mask_val = cv2.threshold(val, val_thresh, 255, cv2.THRESH_BINARY)
    mask_color = cv2.bitwise_and(mask_sat, mask_val)
    
    # Combine all cues
    combined = cv2.bitwise_or(mask_grad, cv2.bitwise_or(mask_diff, cv2.bitwise_or(mask_bright, mask_color)))
    
    # Close small internal character gaps (e.g. inside 'O', 'A', 'P')
    kernel_close = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    closed = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel_close)
    
    # Remove isolated noise
    kernel_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2, 2))
    cleaned = cv2.morphologyEx(closed, cv2.MORPH_OPEN, kernel_open)
    
    # Dilate mask carefully to cover anti-aliased character edges without ballooning
    d_size = max(1, int(dilation))
    kernel_dilate = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (d_size * 2 + 1, d_size * 2 + 1))
    dilated_mask = cv2.dilate(cleaned, kernel_dilate, iterations=1)
    
    return dilated_mask

def inpaint_directional_horizontal(roi, mask):
    """
    Directional horizontal scanline inpainting.
    For watermarks spanning distinct horizontal color zones (e.g. clothing vs chair),
    interpolates ONLY horizontally so colors never bleed vertically.
    """
    bh, bw = roi.shape[:2]
    res = roi.copy()
    
    for y in range(bh):
        row_mask = mask[y] > 0
        if not np.any(row_mask):
            continue
        
        row_pixels = res[y]
        segments = []
        start = None
        for x in range(bw):
            if row_mask[x]:
                if start is None:
                    start = x
            else:
                if start is not None:
                    segments.append((start, x - 1))
                    start = None
        if start is not None:
            segments.append((start, bw - 1))
            
        for x_start, x_end in segments:
            left_idx = max(0, x_start - 1)
            right_idx = min(bw - 1, x_end + 1)
            
            if x_start == 0:
                c_right = row_pixels[right_idx].astype(np.float32)
                row_pixels[x_start:x_end+1] = c_right
            elif x_end == bw - 1:
                c_left = row_pixels[left_idx].astype(np.float32)
                row_pixels[x_start:x_end+1] = c_left
            else:
                c_left = row_pixels[left_idx].astype(np.float32)
                c_right = row_pixels[right_idx].astype(np.float32)
                seg_len = (x_end - x_start) + 2
                for i, cur_x in enumerate(range(x_start, x_end + 1), 1):
                    t = i / seg_len
                    interp = (1.0 - t) * c_left + t * c_right
                    row_pixels[cur_x] = np.clip(interp, 0, 255).astype(np.uint8)
                    
    # Subtle bilateral blend to match natural texture grain
    smooth = cv2.bilateralFilter(res, 5, 20, 20)
    return np.where(mask[:, :, np.newaxis] > 0, smooth, roi)

def inpaint_seamless_clone(img, bx, by, bw, bh):
    """
    Poisson seamless clone from adjacent clean texture (above or below watermark).
    Provides realistic fabric/texture synthesis instead of blurry smudge boxes.
    """
    h, w = img.shape[:2]
    # Sample clean patch: prefer directly above watermark; fallback to below
    if by >= bh:
        source_y = by - bh
    else:
        source_y = min(h - bh, by + bh)
        
    source_patch = img[source_y:source_y+bh, bx:bx+bw].copy()
    
    # Smooth blend mask with feathered edges
    blend_mask = np.ones((bh, bw), dtype=np.uint8) * 255
    cv2.rectangle(blend_mask, (0, 0), (bw-1, bh-1), 0, 2)
    blend_mask = cv2.GaussianBlur(blend_mask, (7, 7), 2)
    
    center = (bx + bw // 2, by + bh // 2)
    try:
        return cv2.seamlessClone(source_patch, img, blend_mask, center, cv2.NORMAL_CLONE)
    except Exception as e:
        print(f"Seamless clone fallback: {e}", file=sys.stderr)
        # Fallback to direct alpha blend
        alpha = blend_mask.astype(np.float32) / 255.0
        alpha_3d = np.repeat(alpha[:, :, np.newaxis], 3, axis=2)
        out = img.copy()
        out[by:by+bh, bx:bx+bw] = (source_patch * alpha_3d + out[by:by+bh, bx:bx+bw] * (1.0 - alpha_3d)).astype(np.uint8)
        return out

def process_single_frame(input_img_path, output_path, boxes_json, mask_only=False, sensitivity=60, dilation=2, inpaint_radius=3, algorithm='precision_inpaint'):
    img = cv2.imread(input_img_path)
    if img is None:
        raise ValueError(f"Could not read image at {input_img_path}")
        
    h, w = img.shape[:2]
    full_mask = np.zeros((h, w), dtype=np.uint8)
    boxes = json.loads(boxes_json) if isinstance(boxes_json, str) else boxes_json
    
    # Check if crop algorithm is chosen
    if algorithm == 'crop':
        # Crop out bottom or specific box
        # If box is at bottom, crop from top to box.y
        lowest_y = h
        for b in boxes:
            by = max(0, int(b.get('y', 0)))
            if by > h * 0.5:
                lowest_y = min(lowest_y, by)
        crop_h = lowest_y if lowest_y < h else int(h * 0.8)
        cropped = img[0:crop_h, 0:w]
        cv2.imwrite(output_path, cropped)
        return
        
    result_img = img.copy()
    
    for b in boxes:
        bx = max(0, int(b.get('x', 0)))
        by = max(0, int(b.get('y', 0)))
        bw = int(b.get('w', 0))
        bh = int(b.get('h', 0))
        box_algo = b.get('algorithm') or algorithm or 'precision_inpaint'
        
        bw = min(bw, w - bx)
        bh = min(bh, h - by)
        
        if bw <= 4 or bh <= 4:
            continue
            
        roi = result_img[by:by+bh, bx:bx+bw]
        box_sensitivity = int(b.get('sensitivity', sensitivity))
        box_dilation = int(b.get('dilation', dilation))
        box_mask = create_text_mask(roi, sensitivity=box_sensitivity, dilation=box_dilation)
        full_mask[by:by+bh, bx:bx+bw] = cv2.bitwise_or(full_mask[by:by+bh, bx:bx+bw], box_mask)
        
        if box_algo == 'seamless_clone':
            result_img = inpaint_seamless_clone(result_img, bx, by, bw, bh)
        elif box_algo == 'directional':
            result_img[by:by+bh, bx:bx+bw] = inpaint_directional_horizontal(roi, box_mask)
            
    if mask_only:
        # Create glowing cyan visualization overlay
        color_mask = np.zeros_like(img)
        color_mask[:, :, 0] = full_mask  # B: 255
        color_mask[:, :, 1] = full_mask  # G: 255
        color_mask[:, :, 2] = 0          # R: 0 -> Neon Cyan
        overlay = cv2.addWeighted(img, 0.65, color_mask, 0.35, 0)
        cv2.imwrite(output_path, overlay)
        return
        
    if algorithm not in ('seamless_clone', 'directional'):
        # Precision Navier-Stokes inpaint (avoids blurry halos)
        r = max(2, min(5, int(inpaint_radius)))
        inpainted = cv2.inpaint(result_img, full_mask, inpaintRadius=r, flags=cv2.INPAINT_NS)
        cv2.imwrite(output_path, inpainted)
    else:
        cv2.imwrite(output_path, result_img)

def generate_video_mask(input_sample_frame, output_mask_path, boxes_json, sensitivity=60, dilation=2):
    img = cv2.imread(input_sample_frame)
    if img is None:
        raise ValueError(f"Could not read frame at {input_sample_frame}")
    h, w = img.shape[:2]
    full_mask = np.zeros((h, w), dtype=np.uint8)
    
    boxes = json.loads(boxes_json) if isinstance(boxes_json, str) else boxes_json
    for b in boxes:
        bx = max(0, int(b.get('x', 0)))
        by = max(0, int(b.get('y', 0)))
        bw = min(int(b.get('w', 0)), w - bx)
        bh = min(int(b.get('h', 0)), h - by)
        if bw <= 4 or bh <= 4:
            continue
        roi = img[by:by+bh, bx:bx+bw]
        box_mask = create_text_mask(roi, sensitivity=int(b.get('sensitivity', sensitivity)), dilation=int(b.get('dilation', dilation)))
        full_mask[by:by+bh, bx:bx+bw] = cv2.bitwise_or(full_mask[by:by+bh, bx:bx+bw], box_mask)
        
    cv2.imwrite(output_mask_path, full_mask)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='Input frame image')
    parser.add_argument('--output', required=True, help='Output image path')
    parser.add_argument('--boxes', required=True, help='JSON string of bounding boxes')
    parser.add_argument('--mask-only', action='store_true', help='Output mask visualization')
    parser.add_argument('--sensitivity', type=int, default=60)
    parser.add_argument('--dilation', type=int, default=2)
    parser.add_argument('--radius', type=int, default=3)
    parser.add_argument('--algorithm', default='precision_inpaint')
    parser.add_argument('--generate-video-mask', action='store_true')
    
    args = parser.parse_args()
    
    if args.generate_video_mask:
        generate_video_mask(args.input, args.output, args.boxes, args.sensitivity, args.dilation)
    else:
        process_single_frame(args.input, args.output, args.boxes, args.mask_only, args.sensitivity, args.dilation, args.radius, args.algorithm)


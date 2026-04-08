let isOpencvReady = false;
let srcImage = null;
let clonesData = []; 
let rois = []; 
let appMode = 'edit_points'; 
let isDrawing = false;
let startX = 0, startY = 0;
let currentRoi = null;
let editingCloneIndex = -1;

// 红色科研级配色
const COLORS = {
    PRIMARY_RED: '#E64B35',
    ROI_BLUE: 'rgba(59, 130, 246, 0.7)',
    HIGHLIGHT_BG: 'rgba(230, 75, 53, 0.25)'
};

function onOpenCvReady() {
    isOpencvReady = true;
    document.getElementById('loadingMsg').innerText = "分析引擎就绪";
    document.getElementById('loadingMsg').style.color = "#10b981";
}

// 切换框选模式
document.getElementById('toggleRoiMode').addEventListener('click', function() {
    appMode = (appMode === 'edit_points') ? 'draw_roi' : 'edit_points';
    const indicator = document.getElementById('modeDisplay');
    if (appMode === 'draw_roi') {
        this.classList.add('active');
        indicator.innerText = "当前模式：框选区域";
        indicator.style.background = "#fee2e2";
        indicator.style.color = "#991b1b";
    } else {
        this.classList.remove('active');
        indicator.innerText = "当前模式：结果修正";
        indicator.style.background = "#dcfce7";
        indicator.style.color = "#166534";
    }
});

document.getElementById('clearRois').addEventListener('click', () => {
    rois = [];
    runAutoDetection(); 
});

document.getElementById('imageInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = document.getElementById('rawImage');
            img.src = event.target.result;
            img.onload = () => {
                if (srcImage) srcImage.delete();
                srcImage = cv.imread(img);
                runAutoDetection();
            };
        };
        reader.readAsDataURL(file);
    }
});

['colorTolerance', 'circularitySlider', 'minAreaSlider'].forEach(id => {
    document.getElementById(id).addEventListener('input', runAutoDetection);
});

// --- 核心：识别与过滤逻辑 ---
function runAutoDetection() {
    if (!srcImage) return;
    clonesData = [];
    
    const tolerance = parseInt(document.getElementById('colorTolerance').value);
    const minCircularity = parseInt(document.getElementById('circularitySlider').value) / 100.0;
    const minAreaVal = parseInt(document.getElementById('minAreaSlider').value);

    let hsv = new cv.Mat();
    let mask = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    try {
        cv.cvtColor(srcImage, hsv, cv.COLOR_RGBA2RGB);
        cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

        // 紫色识别区间 (针对结晶紫)
        let lowerH = Math.max(0, 140 - tolerance);
        let upperH = Math.min(180, 140 + tolerance);
        let low = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [lowerH, 40, 30, 0]);
        let high = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [upperH, 255, 255, 255]);
        
        cv.inRange(hsv, low, high, mask);

        // 闭运算增强集落完整性
        let M = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
        cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, M);

        cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);
            
            if (area >= minAreaVal) {
                let perimeter = cv.arcLength(cnt, true);
                let circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;

                if (circularity >= minCircularity) {
                    let circle = cv.minEnclosingCircle(cnt);
                    
                    let isInsideAnyRoi = rois.length === 0; 
                    for (let roi of rois) {
                        if (circle.center.x >= roi.x && circle.center.x <= roi.x + roi.w &&
                            circle.center.y >= roi.y && circle.center.y <= roi.y + roi.h) {
                            isInsideAnyRoi = true;
                            break;
                        }
                    }

                    if (isInsideAnyRoi) {
                        clonesData.push({
                            x: circle.center.x, y: circle.center.y, r: circle.radius,
                            totalArea: area, count: 1, isManual: false
                        });
                    }
                }
            }
        }
    } finally {
        hsv.delete(); mask.delete(); contours.delete(); hierarchy.delete();
        low.delete(); high.delete();
    }
    render();
}

// --- 绘图与实时计数更新 ---
function render() {
    if (!srcImage) return;
    const canvas = document.getElementById('imageCanvas');
    canvas.width = srcImage.cols;
    canvas.height = srcImage.rows;
    cv.imshow('imageCanvas', srcImage);
    const ctx = canvas.getContext('2d');

    // 绘制选区
    ctx.strokeStyle = COLORS.ROI_BLUE;
    ctx.lineWidth = 4;
    rois.forEach(roi => {
        ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
        ctx.fillRect(roi.x, roi.y, roi.w, roi.h);
    });

    if (isDrawing && currentRoi) {
        ctx.setLineDash([10, 5]);
        ctx.strokeStyle = COLORS.PRIMARY_RED;
        ctx.strokeRect(currentRoi.x, currentRoi.y, currentRoi.w, currentRoi.h);
        ctx.setLineDash([]); 
    }

    // 统计逻辑
    let totalCountSum = 0;
    let totalAreaSum = 0;

    clonesData.forEach(c => {
        ctx.beginPath();
        const drawRadius = Math.max(c.r, 10);
        ctx.arc(c.x, c.y, drawRadius, 0, 2 * Math.PI);
        
        ctx.strokeStyle = COLORS.PRIMARY_RED;
        ctx.lineWidth = c.count > 1 ? 8 : 5; // 融合大集落使用特粗线
        ctx.stroke();
        
        if (c.count > 1) {
            // 人工修正过的显示视觉增强
            ctx.fillStyle = COLORS.HIGHLIGHT_BG;
            ctx.fill();
            
            ctx.fillStyle = COLORS.PRIMARY_RED;
            ctx.font = 'bold 28px Arial';
            ctx.shadowBlur = 4;
            ctx.shadowColor = "white";
            ctx.fillText(c.count, c.x + drawRadius + 5, c.y);
            ctx.shadowBlur = 0;
        }
        
        totalCountSum += c.count;
        totalAreaSum += c.totalArea;
    });

    // 实时更新统计数值
    document.getElementById('totalCount').innerText = totalCountSum;
    document.getElementById('avgArea').innerText = totalCountSum > 0 ? (totalAreaSum / totalCountSum).toFixed(1) : 0;
}

// --- 交互处理 ---
function getMousePos(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (evt.clientX - rect.left) * scaleX,
        y: (evt.clientY - rect.top) * scaleY
    };
}

canvas.addEventListener('mousedown', function(e) {
    if (!srcImage) return;
    const pos = getMousePos(canvas, e);

    if (appMode === 'draw_roi') {
        isDrawing = true;
        startX = pos.x; startY = pos.y;
    } else {
        // 判定点击了哪个集落
        let idx = clonesData.findIndex(c => Math.sqrt((c.x-pos.x)**2 + (c.y-pos.y)**2) < Math.max(c.r, 15) + 10);
        if (idx !== -1) {
            editingCloneIndex = idx;
            document.getElementById('manualCountInput').value = clonesData[idx].count;
            document.getElementById('editModal').style.display = 'flex';
            setTimeout(() => document.getElementById('manualCountInput').select(), 100);
        }
    }
});

canvas.addEventListener('mousemove', function(e) {
    if (!isDrawing) return;
    const pos = getMousePos(canvas, e);
    currentRoi = {
        x: Math.min(startX, pos.x),
        y: Math.min(startY, pos.y),
        w: Math.abs(pos.x - startX),
        h: Math.abs(pos.y - startY)
    };
    render(); 
});

canvas.addEventListener('mouseup', function() {
    if (isDrawing) {
        isDrawing = false;
        if (currentRoi && currentRoi.w > 15) rois.push(currentRoi);
        currentRoi = null;
        runAutoDetection(); 
    }
});

// --- 弹窗逻辑 ---
document.getElementById('saveEditBtn').onclick = function() {
    if (editingCloneIndex !== -1) {
        let val = parseInt(document.getElementById('manualCountInput').value);
        if (!isNaN(val)) {
            if (val === 0) clonesData.splice(editingCloneIndex, 1);
            else clonesData[editingCloneIndex].count = val;
            render(); // 实时触发重绘与统计更新
        }
    }
    document.getElementById('editModal').style.display = 'none';
};

document.getElementById('cancelEditBtn').onclick = () => document.getElementById('editModal').style.display = 'none';

// Excel 导出
document.getElementById('exportBtn').onclick = () => {
    const data = clonesData.map((c, i) => ({
        "序号": i + 1, "集落包含细胞数": c.count, "集落像素面积": c.totalArea.toFixed(1), "单个细胞平均像素": (c.totalArea / c.count).toFixed(1)
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "分析结果");
    XLSX.writeFile(wb, `Colony_Report_${new Date().getTime()}.xlsx`);
};

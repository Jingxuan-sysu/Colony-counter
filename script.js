let isOpencvReady = false;
let srcImage = null;
let clonesData = []; 
let rois = []; 
let appMode = 'edit_points'; 
let isDrawing = false;
let startX = 0, startY = 0;
let currentRoi = null;

// 用于记录当前正在编辑的集落索引
let editingCloneIndex = -1;

function onOpenCvReady() {
    isOpencvReady = true;
    document.getElementById('loadingMsg').innerText = "引擎就绪，请上传实验图片";
    document.getElementById('loadingMsg').style.color = "#10b981";
}

document.getElementById('toggleRoiMode').addEventListener('click', function() {
    appMode = (appMode === 'edit_points') ? 'draw_roi' : 'edit_points';
    const btn = this;
    const indicator = document.getElementById('modeDisplay');
    if (appMode === 'draw_roi') {
        btn.innerText = "退出 框选区域模式";
        btn.classList.add('active');
        indicator.innerText = "当前模式：鼠标拖拽框选计数孔";
        indicator.style.background = "#fee2e2";
        indicator.style.color = "#991b1b";
    } else {
        btn.innerText = "开启 框选区域模式";
        btn.classList.remove('active');
        indicator.innerText = "当前模式：点击集落进行数值修改";
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

// 监听所有滑块更新
['colorTolerance', 'circularitySlider', 'minAreaSlider'].forEach(id => {
    document.getElementById(id).addEventListener('input', runAutoDetection);
});

// --- 核心算法升级：HSV紫色提取 + 圆度计算 ---
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
        // 1. 将图像转换为 HSV 色彩空间
        cv.cvtColor(srcImage, hsv, cv.COLOR_RGBA2RGB);
        cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

        // 2. 结晶紫/紫色的 HSV 范围过滤
        // OpenCv中 Hue 的范围是 0-180。紫色通常在 120-160 之间。
        let lowerH = Math.max(0, 140 - tolerance);
        let upperH = Math.min(180, 140 + tolerance);
        
        // 提取紫色：设置饱和度 S 和亮度 V 的最低阈值以排除纯黑/纯白背景
        let low = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [lowerH, 30, 20, 0]);
        let high = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [upperH, 255, 255, 255]);
        
        cv.inRange(hsv, low, high, mask);

        // 形态学开运算去噪 (消除极小杂点)
        let M = cv.Mat.ones(3, 3, cv.CV_8U);
        cv.morphologyEx(mask, mask, cv.MORPH_OPEN, M);

        // 3. 提取轮廓
        cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);
            
            if (area >= minAreaVal) {
                // 4. 计算圆度 (Circularity)
                let perimeter = cv.arcLength(cnt, true);
                let circularity = 0;
                if (perimeter > 0) {
                    circularity = (4 * Math.PI * area) / (perimeter * perimeter);
                }

                // 只有符合圆度要求的才算作标准克隆
                if (circularity >= minCircularity) {
                    let circle = cv.minEnclosingCircle(cnt);
                    
                    let isInsideAnyRoi = false;
                    if (rois.length > 0) {
                        for (let roi of rois) {
                            if (circle.center.x >= roi.x && circle.center.x <= roi.x + roi.w &&
                                circle.center.y >= roi.y && circle.center.y <= roi.y + roi.h) {
                                isInsideAnyRoi = true;
                                break;
                            }
                        }
                    } else {
                        isInsideAnyRoi = true; 
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
    } catch (err) {
        console.error("图像处理错误:", err);
    } finally {
        hsv.delete(); mask.delete(); contours.delete(); hierarchy.delete();
        if(typeof M !== 'undefined') M.delete(); low.delete(); high.delete();
    }
    
    render();
}

// --- 渲染：红框加粗呈现 ---
function render() {
    if (!srcImage) return;
    const canvas = document.getElementById('imageCanvas');
    canvas.width = srcImage.cols;
    canvas.height = srcImage.rows;
    cv.imshow('imageCanvas', srcImage);
    const ctx = canvas.getContext('2d');

    // 绘制框选区域
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.lineWidth = 3;
    rois.forEach(roi => {
        ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.05)';
        ctx.fillRect(roi.x, roi.y, roi.w, roi.h);
    });

    if (isDrawing && currentRoi) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#ef4444';
        ctx.strokeRect(currentRoi.x, currentRoi.y, currentRoi.w, currentRoi.h);
        ctx.setLineDash([]); 
    }

    // 绘制集落：全部采用高对比科研红 #E64B35，粗线条
    let total = 0, areaSum = 0;
    clonesData.forEach(c => {
        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.max(c.r, 8), 0, 2 * Math.PI);
        
        ctx.strokeStyle = '#E64B35'; // 强烈的红色边框
        ctx.lineWidth = c.count > 1 ? 6 : 4; // 融合集落线条更粗
        ctx.stroke();
        
        // 如果是修改过的融合集落，显示显眼的数字标签
        if (c.count > 1) {
            ctx.fillStyle = '#E64B35';
            ctx.font = 'bold 26px Arial';
            ctx.fillText(c.count, c.x + c.r + 5, c.y);
            
            // 给圈内加个轻微的底色区分
            ctx.fillStyle = 'rgba(230, 75, 53, 0.2)';
            ctx.fill();
        }
        total += c.count;
        areaSum += c.totalArea;
    });

    document.getElementById('totalCount').innerText = total;
    document.getElementById('avgArea').innerText = total > 0 ? (areaSum / total).toFixed(1) : 0;
}

function getMousePos(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (evt.clientX - rect.left) * scaleX,
        y: (evt.clientY - rect.top) * scaleY
    };
}

const canvas = document.getElementById('imageCanvas');

canvas.addEventListener('mousedown', function(e) {
    if (!srcImage) return;
    const pos = getMousePos(canvas, e);

    if (appMode === 'draw_roi') {
        isDrawing = true;
        startX = pos.x;
        startY = pos.y;
    } else {
        // --- 交互升级：触发修改弹窗 ---
        let idx = clonesData.findIndex(c => Math.sqrt((c.x-pos.x)**2 + (c.y-pos.y)**2) < Math.max(c.r, 12) + 5);
        if (idx !== -1) {
            editingCloneIndex = idx;
            document.getElementById('manualCountInput').value = clonesData[idx].count;
            document.getElementById('editModal').style.display = 'flex';
            setTimeout(() => document.getElementById('manualCountInput').focus(), 100);
        }
    }
});

canvas.addEventListener('mousemove', function(e) {
    if (!isDrawing || appMode !== 'draw_roi') return;
    const pos = getMousePos(canvas, e);
    currentRoi = {
        x: Math.min(startX, pos.x),
        y: Math.min(startY, pos.y),
        w: Math.abs(pos.x - startX),
        h: Math.abs(pos.y - startY)
    };
    render(); 
});

canvas.addEventListener('mouseup', function(e) {
    if (isDrawing && appMode === 'draw_roi') {
        isDrawing = false;
        if (currentRoi && currentRoi.w > 10 && currentRoi.h > 10) { 
            rois.push(currentRoi);
        }
        currentRoi = null;
        runAutoDetection(); 
    }
});

// --- 弹窗保存/取消逻辑 ---
document.getElementById('cancelEditBtn').addEventListener('click', () => {
    document.getElementById('editModal').style.display = 'none';
    editingCloneIndex = -1;
});

document.getElementById('saveEditBtn').addEventListener('click', () => {
    if (editingCloneIndex !== -1) {
        let val = parseInt(document.getElementById('manualCountInput').value);
        if (!isNaN(val)) {
            if (val === 0) {
                clonesData.splice(editingCloneIndex, 1);
            } else {
                clonesData[editingCloneIndex].count = val;
                clonesData[editingCloneIndex].isManual = true;
            }
            render();
        }
    }
    document.getElementById('editModal').style.display = 'none';
    editingCloneIndex = -1;
});

// 回车键快速保存
document.getElementById('manualCountInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') document.getElementById('saveEditBtn').click();
});


document.getElementById('exportBtn').addEventListener('click', () => {
    const data = clonesData.map((c, i) => ({
        "ID": i + 1, "细胞数": c.count, "面积(px)": c.totalArea.toFixed(1)
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Result");
    XLSX.writeFile(wb, "Colony_Analysis.xlsx");
});

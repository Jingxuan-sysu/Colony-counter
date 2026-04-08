let isOpencvReady = false;
let srcImage = null;
let clonesData = []; 
let rois = []; // 存储所有手动框选的矩形区域 {x, y, w, h}
let appMode = 'edit_points'; // 模式：'edit_points' (点选细胞) 或 'draw_roi' (框选区域)

// 拖拽画框的状态变量
let isDrawing = false;
let startX = 0, startY = 0;
let currentRoi = null;

function onOpenCvReady() {
    isOpencvReady = true;
    document.getElementById('loadingMsg').innerText = "引擎就绪，请上传实验图片";
    document.getElementById('loadingMsg').style.color = "#10b981";
}

// 切换框选模式
document.getElementById('toggleRoiMode').addEventListener('click', function() {
    appMode = (appMode === 'edit_points') ? 'draw_roi' : 'edit_points';
    const btn = this;
    const indicator = document.getElementById('modeDisplay');
    if (appMode === 'draw_roi') {
        btn.innerText = "退出 框选区域模式";
        btn.classList.add('active');
        indicator.innerText = "当前模式：鼠标拖拽框选区域";
        indicator.style.background = "#fee2e2";
        indicator.style.color = "#991b1b";
    } else {
        btn.innerText = "开启 框选区域模式";
        btn.classList.remove('active');
        indicator.innerText = "当前模式：点击修改/添加细胞";
        indicator.style.background = "#dcfce7";
        indicator.style.color = "#166534";
    }
});

document.getElementById('clearRois').addEventListener('click', () => {
    rois = [];
    runAutoDetection(); // 清除区域后重新计算
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

['thresholdSlider', 'minAreaSlider'].forEach(id => {
    document.getElementById(id).addEventListener('input', runAutoDetection);
});

// 核心逻辑：自动识别并过滤
function runAutoDetection() {
    if (!srcImage) return;
    clonesData = [];
    const thresholdVal = parseInt(document.getElementById('thresholdSlider').value);
    const minAreaVal = parseInt(document.getElementById('minAreaSlider').value);

    let gray = new cv.Mat();
    let blurred = new cv.Mat();
    let binary = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    cv.cvtColor(srcImage, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.threshold(blurred, binary, thresholdVal, 255, cv.THRESH_BINARY_INV);
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        if (area >= minAreaVal) {
            let circle = cv.minEnclosingCircle(cnt);
            
            // 检查克隆点是否在用户画的矩形框内 (如果没画框，默认不识别)
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
                // 如果没有框选任何区域，默认识别全图 (如果你想严格要求必须框选才识别，把这里的 true 改为 false)
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
    gray.delete(); blurred.delete(); binary.delete(); contours.delete(); hierarchy.delete();
    render();
}

function render() {
    if (!srcImage) return;
    const canvas = document.getElementById('imageCanvas');
    canvas.width = srcImage.cols;
    canvas.height = srcImage.rows;
    cv.imshow('imageCanvas', srcImage);
    const ctx = canvas.getContext('2d');

    // 绘制用户已框选的区域 (ROIs)
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.lineWidth = 3;
    rois.forEach(roi => {
        ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.05)';
        ctx.fillRect(roi.x, roi.y, roi.w, roi.h);
    });

    // 绘制正在拖拽中的虚线框
    if (isDrawing && currentRoi) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#ef4444';
        ctx.strokeRect(currentRoi.x, currentRoi.y, currentRoi.w, currentRoi.h);
        ctx.setLineDash([]); // 恢复实线
    }

    // 绘制识别出的克隆点 (大幅加粗线条)
    let total = 0, areaSum = 0;
    clonesData.forEach(c => {
        ctx.beginPath();
        // 如果半径太小，画一个最小可视圆
        ctx.arc(c.x, c.y, Math.max(c.r, 6), 0, 2 * Math.PI);
        
        if (c.count > 1) {
            ctx.strokeStyle = '#f97316'; // 橙色
            ctx.lineWidth = 6;           // 融合克隆，更粗
        } else {
            ctx.strokeStyle = '#22c55e'; // 绿色
            ctx.lineWidth = 4;           // 单克隆加粗
        }
        ctx.stroke();
        
        if (c.count > 1) {
            ctx.fillStyle = '#f97316';
            ctx.font = 'bold 24px Arial';
            ctx.fillText(c.count, c.x + c.r + 5, c.y);
        }
        total += c.count;
        areaSum += c.totalArea;
    });

    document.getElementById('totalCount').innerText = total;
    document.getElementById('avgArea').innerText = total > 0 ? (areaSum / total).toFixed(1) : 0;
}

// --------- 画布鼠标交互 (框选 与 点击修改) ---------

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
        // 模式：点击修改或删除
        let idx = clonesData.findIndex(c => Math.sqrt((c.x-pos.x)**2 + (c.y-pos.y)**2) < Math.max(c.r, 10) + 10);
        if (idx !== -1) {
            let n = prompt("输入该区域包含的细胞数 (0为删除):", clonesData[idx].count);
            if (n !== null) {
                if (parseInt(n) === 0) clonesData.splice(idx, 1);
                else clonesData[idx].count = parseInt(n);
                render();
            }
        }
    }
});

canvas.addEventListener('mousemove', function(e) {
    if (!isDrawing || appMode !== 'draw_roi') return;
    const pos = getMousePos(canvas, e);
    // 处理反向拖拽
    currentRoi = {
        x: Math.min(startX, pos.x),
        y: Math.min(startY, pos.y),
        w: Math.abs(pos.x - startX),
        h: Math.abs(pos.y - startY)
    };
    render(); // 实时渲染拖拽框
});

canvas.addEventListener('mouseup', function(e) {
    if (isDrawing && appMode === 'draw_roi') {
        isDrawing = false;
        if (currentRoi && currentRoi.w > 10 && currentRoi.h > 10) { // 忽略太小的误触点击
            rois.push(currentRoi);
        }
        currentRoi = null;
        runAutoDetection(); // 框选完成后重新执行识别
    }
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

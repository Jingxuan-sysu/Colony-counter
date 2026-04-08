let isOpencvReady = false;
let srcImage = null;
let clonesData = []; 
let wells = []; // 存储选区 {x, y, r}
let appMode = 'detect'; // 'detect' 或 'edit_wells'

function onOpenCvReady() {
    isOpencvReady = true;
    document.getElementById('loadingMsg').innerText = "引擎就绪，请上传实验图片";
    document.getElementById('loadingMsg').style.color = "#10b981";
}

// 切换选位模式
document.getElementById('toggleWellMode').addEventListener('click', function() {
    appMode = (appMode === 'detect') ? 'edit_wells' : 'detect';
    const btn = this;
    const indicator = document.getElementById('modeDisplay');
    if (appMode === 'edit_wells') {
        btn.innerText = "退出选位模式";
        btn.classList.add('active');
        indicator.innerText = "当前模式：设置分析孔位";
        indicator.style.background = "#fee2e2";
        indicator.style.color = "#991b1b";
    } else {
        btn.innerText = "开启选位模式";
        btn.classList.remove('active');
        indicator.innerText = "当前模式：分析计数";
        indicator.style.background = "#dcfce7";
        indicator.style.color = "#166534";
        runAutoDetection(); // 退出时重新识别
    }
});

document.getElementById('clearWells').addEventListener('click', () => {
    wells = [];
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
['thresholdSlider', 'minAreaSlider', 'wellRadiusSlider'].forEach(id => {
    document.getElementById(id).addEventListener('input', runAutoDetection);
});

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
            
            // 【核心逻辑】：如果设置了 Wells，检查此点是否在任何一个 Well 内部
            let isInsideAnyWell = wells.length === 0; // 若未设定选区，默认全选
            for (let well of wells) {
                let dist = Math.sqrt(Math.pow(circle.center.x - well.x, 2) + Math.pow(circle.center.y - well.y, 2));
                if (dist <= well.r) {
                    isInsideAnyWell = true;
                    break;
                }
            }

            if (isInsideAnyWell) {
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
    const canvas = document.getElementById('imageCanvas');
    canvas.width = srcImage.cols;
    canvas.height = srcImage.rows;
    cv.imshow('imageCanvas', srcImage);
    const ctx = canvas.getContext('2d');

    // 绘制选区 (Wells)
    wells.forEach(well => {
        ctx.beginPath();
        ctx.arc(well.x, well.y, well.r, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
        ctx.fill();
    });

    // 绘制克隆点
    let total = 0, areaSum = 0;
    clonesData.forEach(c => {
        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.max(c.r, 4), 0, 2 * Math.PI);
        ctx.strokeStyle = c.count > 1 ? '#f97316' : '#22c55e';
        ctx.lineWidth = 2;
        ctx.stroke();
        if (c.count > 1) {
            ctx.fillStyle = '#f97316';
            ctx.fillText(c.count, c.x + 5, c.y - 5);
        }
        total += c.count;
        areaSum += c.totalArea;
    });

    document.getElementById('totalCount').innerText = total;
    document.getElementById('avgArea').innerText = total > 0 ? (areaSum / total).toFixed(1) : 0;
}

document.getElementById('imageCanvas').addEventListener('click', function(e) {
    if (!srcImage) return;
    const rect = this.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (this.width / rect.width);
    const y = (e.clientY - rect.top) * (this.height / rect.height);

    if (appMode === 'edit_wells') {
        // 模式1：添加孔位选区
        wells.push({ x, y, r: parseInt(document.getElementById('wellRadiusSlider').value) });
        runAutoDetection();
    } else {
        // 模式2：分析计数交互
        let idx = clonesData.findIndex(c => Math.sqrt((c.x-x)**2 + (c.y-y)**2) < c.r + 10);
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

document.getElementById('exportBtn').addEventListener('click', () => {
    const data = clonesData.map((c, i) => ({
        "ID": i + 1, "细胞数": c.count, "面积(px)": c.totalArea.toFixed(1)
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Result");
    XLSX.writeFile(wb, "Colony_Analysis.xlsx");
});

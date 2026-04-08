// 全局状态变量
let isOpencvReady = false;
let srcImage = null; // 存储原始图像的 OpenCV Mat 对象
let clonesData = []; // 存储所有识别到的克隆数据
let displayScale = 1; // 画布缩放比例

// 初始化：当 OpenCV.js 加载完成后触发
function onOpenCvReady() {
    isOpencvReady = true;
    const loadingMsg = document.getElementById('loadingMsg');
    loadingMsg.innerText = "引擎加载成功！请上传图片。";
    loadingMsg.style.color = "#4CAF50";
    
    // 启用UI控件
    document.getElementById('thresholdSlider').disabled = false;
    document.getElementById('minAreaSlider').disabled = false;
    document.getElementById('exportBtn').disabled = false;
}

// 1. 处理图片上传
document.getElementById('imageInput').addEventListener('change', function(e) {
    if (!isOpencvReady) {
        alert("请等待图像处理引擎加载完成！");
        return;
    }
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(event) {
            const imgElement = document.getElementById('rawImage');
            imgElement.src = event.target.result;
            imgElement.onload = function() {
                // 清理旧内存
                if (srcImage != null) srcImage.delete();
                // 读取新图像
                srcImage = cv.imread(imgElement);
                // 执行自动识别
                runAutoDetection(); 
            }
        };
        reader.readAsDataURL(file);
    }
});

// 监听滑动条改变（重新运行自动识别）
document.getElementById('thresholdSlider').addEventListener('change', runAutoDetection);
document.getElementById('minAreaSlider').addEventListener('change', runAutoDetection);

// 2. 核心算法：自动识别克隆
function runAutoDetection() {
    if (!srcImage) return;

    const thresholdVal = parseInt(document.getElementById('thresholdSlider').value);
    const minAreaVal = parseInt(document.getElementById('minAreaSlider').value);

    // 每次重新自动识别，清空当前数据
    clonesData = [];

    // 创建临时 Mat 对象用于图像处理
    let gray = new cv.Mat();
    let blurred = new cv.Mat();
    let binary = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    try {
        // 步骤 A: 灰度化
        cv.cvtColor(srcImage, gray, cv.COLOR_RGBA2GRAY, 0);
        
        // 步骤 B: 高斯模糊去噪 (核大小 5x5)
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
        
        // 步骤 C: 二值化 (固定阈值，根据滑块调整)
        // 注意：如果是深色细胞在浅色背景上，使用 THRESH_BINARY_INV。根据您的实验图片调整。
        cv.threshold(blurred, binary, thresholdVal, 255, cv.THRESH_BINARY_INV);
        
        // 步骤 D: 提取轮廓
        cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        // 步骤 E: 过滤并记录数据
        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);
            
            if (area >= minAreaVal) {
                // 获取外接圆，用于交互时的点击判定
                let circle = cv.minEnclosingCircle(cnt);
                clonesData.push({
                    id: 'auto_' + i,
                    x: circle.center.x,
                    y: circle.center.y,
                    r: circle.radius,
                    totalArea: area, // 像素总面积
                    count: 1,        // 默认该区域包含 1 个克隆/细胞
                    isManual: false
                });
            }
        }
    } catch (err) {
        console.error("图像处理出错: ", err);
    } finally {
        // 释放内存，防止浏览器崩溃
        gray.delete(); blurred.delete(); binary.delete(); contours.delete(); hierarchy.delete();
    }

    // 绘制结果并更新统计
    renderCanvas();
}

// 3. 渲染画布与标记
function renderCanvas() {
    if (!srcImage) return;

    const canvas = document.getElementById('imageCanvas');
    // 设置画布尺寸与原图一致，利用 CSS 控制显示大小
    canvas.width = srcImage.cols;
    canvas.height = srcImage.rows;
    
    // 将原图画到 Canvas 上
    cv.imshow('imageCanvas', srcImage);

    const ctx = canvas.getContext('2d');
    let totalCells = 0;
    let totalAreaSum = 0;

    // 绘制所有识别标记
    clonesData.forEach(clone => {
        ctx.beginPath();
        ctx.arc(clone.x, clone.y, Math.max(clone.r, 3), 0, 2 * Math.PI, false);
        
        // 根据数量和来源设置不同颜色
        if (clone.isManual) {
            ctx.strokeStyle = '#2196F3'; // 蓝色：手动新增的
            ctx.lineWidth = 2;
        } else if (clone.count > 1) {
            ctx.strokeStyle = '#FF9800'; // 橙色：修改过多细胞融合
            ctx.lineWidth = 3;
        } else {
            ctx.strokeStyle = '#4CAF50'; // 绿色：默认单克隆
            ctx.lineWidth = 1.5;
        }
        ctx.stroke();

        // 如果是融合克隆，显示数字标签
        if (clone.count > 1) {
            ctx.fillStyle = '#FF9800';
            ctx.font = 'bold 16px Arial';
            ctx.fillText(clone.count, clone.x + clone.r, clone.y - clone.r);
        }

        totalCells += clone.count;
        totalAreaSum += clone.totalArea;
    });

    // 更新右侧面板的统计数据
    document.getElementById('totalCount').innerText = totalCells;
    const avgArea = totalCells > 0 ? (totalAreaSum / totalCells).toFixed(2) : 0;
    document.getElementById('avgArea').innerText = avgArea;
}

// 4. 核心交互：画布点击事件 (修改、新增、删除)
document.getElementById('imageCanvas').addEventListener('click', function(e) {
    if (!srcImage) return;

    const canvas = document.getElementById('imageCanvas');
    const rect = canvas.getBoundingClientRect();
    
    // 计算鼠标在真实图像像素坐标系中的位置
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    // 查找点击位置是否在已知的克隆热区内（允许 5px 的容错点击范围）
    let clickedCloneIndex = clonesData.findIndex(clone => {
        const distance = Math.sqrt(Math.pow(clone.x - clickX, 2) + Math.pow(clone.y - clickY, 2));
        return distance <= (clone.r + 5);
    });

    if (clickedCloneIndex !== -1) {
        // 【情况 A】点击了已有的克隆点：修改数量或删除
        let currentCount = clonesData[clickedCloneIndex].count;
        let newCountStr = prompt("修改此区域的细胞/克隆数量。\n(输入 0 将删除该点)", currentCount);
        
        if (newCountStr !== null) {
            let newCount = parseInt(newCountStr);
            if (!isNaN(newCount)) {
                if (newCount === 0) {
                    // 删除该点
                    clonesData.splice(clickedCloneIndex, 1);
                } else if (newCount > 0) {
                    // 更新数量
                    clonesData[clickedCloneIndex].count = newCount;
                }
                renderCanvas(); // 重新绘制并统计
            }
        }
    } else {
        // 【情况 B】点击了空白区域：新增计数点
        let addConfirm = confirm("在此处新增一个计数点？");
        if (addConfirm) {
            clonesData.push({
                id: 'manual_' + Date.now(),
                x: clickX,
                y: clickY,
                r: 10, // 给个默认画圈半径
                totalArea: parseInt(document.getElementById('minAreaSlider').value), // 默认面积取最小过滤面积
                count: 1,
                isManual: true
            });
            renderCanvas();
        }
    }
});

// 5. 导出 Excel 功能
document.getElementById('exportBtn').addEventListener('click', function() {
    if (clonesData.length === 0) {
        alert("没有数据可导出！");
        return;
    }

    // 整理准备导出的数据格式
    let exportRows = clonesData.map((clone, index) => {
        return {
            "编号": index + 1,
            "来源": clone.isManual ? "手动添加" : "自动识别",
            "中心坐标 X": clone.x.toFixed(1),
            "中心坐标 Y": clone.y.toFixed(1),
            "包含细胞数": clone.count,
            "总面积 (px²)": clone.totalArea.toFixed(1),
            "单个平均面积 (px²)": (clone.totalArea / clone.count).toFixed(1)
        };
    });

    // 计算总体汇总数据
    let totalCells = clonesData.reduce((sum, c) => sum + c.count, 0);
    let totalArea = clonesData.reduce((sum, c) => sum + c.totalArea, 0);
    exportRows.push({}); // 空行分割
    exportRows.push({
        "编号": "汇总",
        "包含细胞数": totalCells,
        "单个平均面积 (px²)": totalCells > 0 ? (totalArea / totalCells).toFixed(1) : 0
    });

    // 使用 SheetJS 生成并下载 Excel
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "计数结果");
    
    // 生成文件名为当前时间
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Cell_Count_Result_${dateStr}.xlsx`);
});

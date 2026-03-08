// ============================================================================
// 常量定义
// ============================================================================

// 初始化 PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

// A4 尺寸 (单位: 点, 72点=1英寸, A4=210mm x 297mm)
const A4_WIDTH = 595;
const A4_HEIGHT = 842;
const MM_TO_PT = 2.83465;

// 渲染配置
const RENDER_CONFIG = {
    pdfScale: 1.5,           // PDF 渲染缩放比例
    pageNumberBottomMargin: 20,  // 页码距离底部的距离
    borderColor: '#ccc',     // 边框颜色
    borderWidth: 1,          // 边框宽度
    cutLineColor: '#999',    // 裁剪线颜色
    cutLineWidth: 0.5,       // 裁剪线宽度
    cutLineDash: [4, 4],     // 裁剪线虚线样式
    pageNumberColor: '#666', // 页码颜色
    pageNumberSize: 12       // 页码字体大小
};

// ============================================================================
// 状态管理
// ============================================================================

// 应用状态
const state = {
    files: [], // 存储上传的文件信息 { file, name, type, pages: [] }
    currentStep: 1,
    currentPreviewPage: 0, // 当前预览页码（从0开始）
    previewCache: new Map(), // 缓存渲染的页面图像
    settings: {
        orientation: 'portrait',
        rows: 2,
        cols: 1,
        margin: 10,
        gap: 5,
        showBorder: false,
        showCutLine: false,
        showPageNumber: false
    }
};

// DOM 元素
const elements = {
    uploadArea: document.getElementById('upload-area'),
    fileInput: document.getElementById('file-input'),
    fileList: document.getElementById('file-list'),
    fileItems: document.getElementById('file-items'),
    fileCount: document.getElementById('file-count'),
    clearAllBtn: document.getElementById('clear-all-btn'),
    nextStep1: document.getElementById('next-step1'),
    printfp: document.getElementById('printfp'),
    prevStep2: document.getElementById('prev-step2'),
    nextStep2: document.getElementById('next-step2'),
    // 预览相关元素
    previewCanvas: document.getElementById('preview-canvas'),
    previewLoading: document.getElementById('preview-loading'),
    prevPreviewPage: document.getElementById('prev-preview-page'),
    nextPreviewPage: document.getElementById('next-preview-page'),
    currentPreviewPage: document.getElementById('current-preview-page'),
    totalPreviewPages: document.getElementById('total-preview-pages'),
    perPageCount: document.getElementById('per-page-count'),
    totalPages: document.getElementById('total-pages')
};

// 步骤面板
const panels = {
    step1: document.getElementById('step1-panel'),
    step2: document.getElementById('step2-panel')
};

// ============================================================================
// 布局计算
// ============================================================================

// 统一的布局计算函数
function calculateLayout(settings) {
    const { rows, cols, margin, gap, orientation } = settings;
    const isLandscape = orientation === 'landscape';
    const pageWidth = isLandscape ? A4_HEIGHT : A4_WIDTH;
    const pageHeight = isLandscape ? A4_WIDTH : A4_HEIGHT;

    const marginPt = margin * MM_TO_PT;
    const gapPt = gap * MM_TO_PT;

    const contentWidth = pageWidth - marginPt * 2;
    const contentHeight = pageHeight - marginPt * 2;
    const cellWidth = (contentWidth - gapPt * (cols - 1)) / cols;
    const cellHeight = (contentHeight - gapPt * (rows - 1)) / rows;
    const perPage = rows * cols;

    return {
        pageWidth,
        pageHeight,
        marginPt,
        gapPt,
        contentWidth,
        contentHeight,
        cellWidth,
        cellHeight,
        perPage,
        rows,
        cols
    };
}

// 计算单元格位置
function calculateCellPosition(index, layout) {
    const { marginPt, gapPt, cellWidth, cellHeight, cols } = layout;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = marginPt + col * (cellWidth + gapPt);
    const y = marginPt + row * (cellHeight + gapPt);

    return { x, y, col, row };
}

// ============================================================================
// 绘制辅助函数
// ============================================================================

// 在 Canvas 上绘制边框
function drawBorderOnCanvas(ctx, x, y, width, height) {
    ctx.strokeStyle = RENDER_CONFIG.borderColor;
    ctx.lineWidth = RENDER_CONFIG.borderWidth;
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, width, height);
}

// 在 Canvas 上绘制裁剪线
function drawCutLinesOnCanvas(ctx, x, y, width, height) {
    ctx.strokeStyle = RENDER_CONFIG.cutLineColor;
    ctx.lineWidth = RENDER_CONFIG.cutLineWidth;
    ctx.setLineDash(RENDER_CONFIG.cutLineDash);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);
}

// 在 Canvas 上绘制页码
function drawPageNumberOnCanvas(ctx, pageWidth, pageHeight, currentPage, totalPages) {
    ctx.fillStyle = RENDER_CONFIG.pageNumberColor;
    ctx.font = `${RENDER_CONFIG.pageNumberSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(
        `${currentPage} / ${totalPages}`,
        pageWidth / 2,
        pageHeight - RENDER_CONFIG.pageNumberBottomMargin
    );
}

// 在 PDF 上绘制边框
function drawBorderOnPdf(page, x, y, width, height, PDFLib) {
    const { rgb } = PDFLib;
    page.drawRectangle({
        x: x,
        y: y,
        width: width,
        height: height,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: RENDER_CONFIG.borderWidth
    });
}

// 在 PDF 上绘制裁剪线
function drawCutLinesOnPdf(page, x, y, width, height, PDFLib) {
    const { rgb } = PDFLib;
    const dashOpts = {
        thickness: RENDER_CONFIG.cutLineWidth,
        color: rgb(0.6, 0.6, 0.6),
        dashArray: RENDER_CONFIG.cutLineDash
    };

    // 顶部
    page.drawLine({ start: { x, y: y + height }, end: { x: x + width, y: y + height }, ...dashOpts });
    // 底部
    page.drawLine({ start: { x, y }, end: { x: x + width, y }, ...dashOpts });
    // 左侧
    page.drawLine({ start: { x, y }, end: { x, y: y + height }, ...dashOpts });
    // 右侧
    page.drawLine({ start: { x: x + width, y }, end: { x: x + width, y: y + height }, ...dashOpts });
}

// 在 PDF 上绘制页码
function drawPageNumberOnPdf(page, pageWidth, currentPage, totalPages, font, PDFLib) {
    const { rgb } = PDFLib;
    const pageNumText = `${currentPage} / ${totalPages}`;
    const textWidth = font.widthOfTextAtSize(pageNumText, 10);

    page.drawText(pageNumText, {
        x: (pageWidth - textWidth) / 2,
        y: RENDER_CONFIG.pageNumberBottomMargin,
        size: 10,
        font: font,
        color: rgb(0.4, 0.4, 0.4)
    });
}

// 在 Canvas 上绘制占位符
function drawPlaceholderOnCanvas(ctx, x, y, width, height, index) {
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(x, y, width, height);

    ctx.strokeStyle = '#d9d9d9';
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);

    ctx.fillStyle = '#999';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`发票 ${index + 1}`, x + width / 2, y + height / 2);
}

// 在 Canvas 上绘制错误占位符
function drawErrorPlaceholderOnCanvas(ctx, x, y, width, height, message) {
    ctx.fillStyle = '#ffebee';
    ctx.fillRect(x, y, width, height);

    ctx.fillStyle = '#f44336';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, x + width / 2, y + height / 2);
}

// ============================================================================
// 初始化和事件监听
// ============================================================================

// 初始化
function init() {
    setupEventListeners();
    updatePreview();
}

// 设置事件监听
function setupEventListeners() {
    // 上传区域点击
    elements.uploadArea.addEventListener('click', () => elements.fileInput.click());

    // 文件选择
    elements.fileInput.addEventListener('change', handleFileSelect);

    // 拖放
    elements.uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.uploadArea.classList.add('dragover');
    });

    elements.uploadArea.addEventListener('dragleave', () => {
        elements.uploadArea.classList.remove('dragover');
    });

    elements.uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.uploadArea.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });

    // 清空全部
    elements.clearAllBtn.addEventListener('click', clearAllFiles);

    // 步骤导航
    elements.nextStep1.addEventListener('click', () => goToStep(2));
    elements.prevStep2.addEventListener('click', () => goToStep(1));
    elements.nextStep2.addEventListener('click', mergeAndDownload);
    elements.printfp.addEventListener('click', printCurrentPage);

    // 设置变更
    document.querySelectorAll('input[name="orientation"]').forEach(input => {
        input.addEventListener('change', (e) => {
            state.settings.orientation = e.target.value;
            updatePreview();
        });
    });

    ['rows', 'cols', 'margin', 'gap'].forEach(id => {
        const el = document.getElementById(id);
        const handler = (e) => {
            state.settings[id] = parseInt(e.target.value) || 1;
            updatePreview();
        };
        el.addEventListener('change', handler);
        el.addEventListener('input', handler);
    });

    ['show-border', 'show-cut-line', 'show-page-number'].forEach(id => {
        const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        document.getElementById(id).addEventListener('change', (e) => {
            state.settings[key] = e.target.checked;
            state.previewCache.clear(); // 清除缓存以重新渲染
            renderPreviewPage();
        });
    });

    // 预览页面导航
    elements.prevPreviewPage.addEventListener('click', () => {
        if (state.currentPreviewPage > 0) {
            state.currentPreviewPage--;
            renderPreviewPage();
        }
    });

    elements.nextPreviewPage.addEventListener('click', () => {
        const totalPagesNeeded = getTotalPreviewPages();
        if (state.currentPreviewPage < totalPagesNeeded - 1) {
            state.currentPreviewPage++;
            renderPreviewPage();
        }
    });
}

// ============================================================================
// 文件处理
// ============================================================================

// 处理文件选择
function handleFileSelect(e) {
    handleFiles(e.target.files);
    e.target.value = ''; // 重置以便重新选择相同文件
}

// 处理文件
async function handleFiles(fileList) {
    const validFiles = Array.from(fileList).filter(file => {
        const ext = file.name.toLowerCase().split('.').pop();
        return ext === 'pdf' || ext === 'ofd';
    });

    if (validFiles.length === 0) {
        alert('请选择 PDF 或 OFD 格式的文件');
        return;
    }

    for (const file of validFiles) {
        const ext = file.name.toLowerCase().split('.').pop();
        const fileInfo = {
            file,
            name: file.name,
            type: ext,
            size: formatFileSize(file.size),
            pages: []
        };

        try {
            if (ext === 'pdf') {
                await loadPDFPages(fileInfo);
            } else if (ext === 'ofd') {
                await loadOFDPages(fileInfo);
            }
            state.files.push(fileInfo);
        } catch (error) {
            console.error(`加载文件 ${file.name} 失败:`, error);
            alert(`加载文件 ${file.name} 失败: ${error.message}`);
        }
    }

    updateFileList();
    updatePreview();
}

// 加载 PDF 页面
async function loadPDFPages(fileInfo) {
    const arrayBuffer = await fileInfo.file.arrayBuffer();
    // 存储为 Uint8Array 副本，避免 ArrayBuffer detach 问题
    fileInfo.pdfData = new Uint8Array(arrayBuffer);
    
    const pdf = await pdfjsLib.getDocument({ 
        data: fileInfo.pdfData.slice(),
        verbosity: 0  // 减少控制台输出
    }).promise;
    fileInfo.pdfDoc = pdf;
    
    for (let i = 1; i <= pdf.numPages; i++) {
        fileInfo.pages.push({
            pageNum: i,
            type: 'pdf'
        });
    }
    
    console.log(`加载PDF成功: ${fileInfo.name}, ${pdf.numPages}页`);
}

// 加载 OFD 页面 (OFD是ZIP格式，包含XML和图片)
async function loadOFDPages(fileInfo) {
    const arrayBuffer = await fileInfo.file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    fileInfo.ofdZip = zip;
    
    // 解析 OFD 结构
    // OFD 文件结构: OFD.xml -> Document_N/Document.xml -> Pages/Page_N/Content.xml
    const ofdXml = await zip.file('OFD.xml')?.async('string');
    if (!ofdXml) {
        throw new Error('无效的 OFD 文件');
    }

    // 查找所有文档
    const docDirs = [];
    zip.forEach((relativePath, file) => {
        const match = relativePath.match(/^(Doc_\d+)\//);
        if (match && !docDirs.includes(match[1])) {
            docDirs.push(match[1]);
        }
    });

    if (docDirs.length === 0) {
        // 尝试其他常见的目录结构
        zip.forEach((relativePath, file) => {
            if (relativePath.includes('Document.xml')) {
                const dir = relativePath.split('/')[0];
                if (!docDirs.includes(dir)) {
                    docDirs.push(dir);
                }
            }
        });
    }

    // 遍历每个文档，提取页面图片
    for (const docDir of docDirs) {
        // 查找该文档中的所有图片资源
        const imageFiles = [];
        zip.forEach((relativePath, file) => {
            if (relativePath.startsWith(docDir) && /\.(png|jpg|jpeg|bmp)$/i.test(relativePath)) {
                imageFiles.push({ path: relativePath, file });
            }
        });

        // 如果找到图片，按顺序添加为页面
        if (imageFiles.length > 0) {
            imageFiles.sort((a, b) => a.path.localeCompare(b.path));
            for (const img of imageFiles) {
                const imageData = await img.file.async('base64');
                const ext = img.path.split('.').pop().toLowerCase();
                const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
                
                fileInfo.pages.push({
                    type: 'ofd-image',
                    pageNum: fileInfo.pages.length + 1,
                    imageData: `data:${mimeType};base64,${imageData}`
                });
            }
        }
    }

    // 如果没有找到图片，尝试渲染页面内容
    if (fileInfo.pages.length === 0) {
        // 简化处理：查找所有嵌入的印章或签章图片
        const allImages = [];
        zip.forEach((relativePath, file) => {
            if (/\.(png|jpg|jpeg|bmp)$/i.test(relativePath)) {
                allImages.push({ path: relativePath, file });
            }
        });

        if (allImages.length > 0) {
            allImages.sort((a, b) => a.path.localeCompare(b.path));
            for (const img of allImages) {
                const imageData = await img.file.async('base64');
                const ext = img.path.split('.').pop().toLowerCase();
                const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

                fileInfo.pages.push({
                    type: 'ofd-image',
                    pageNum: fileInfo.pages.length + 1,
                    imageData: `data:${mimeType};base64,${imageData}`
                });
            }
        } else {
            // 如果仍然没有图片，标记为需要转换
            fileInfo.pages.push({
                type: 'ofd-xml',
                message: 'OFD 矢量内容'
            });
        }
    }
}

// 更新文件列表显示
function updateFileList() {
    if (state.files.length === 0) {
        elements.fileList.style.display = 'none';
        elements.nextStep1.disabled = true;
        return;
    }

    elements.fileList.style.display = 'block';
    elements.nextStep1.disabled = false;
    elements.fileCount.textContent = state.files.length;

    elements.fileItems.innerHTML = state.files.map((file, index) => `
        <div class="file-item">
            <div class="file-item-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
            </div>
            <div class="file-item-info">
                <div class="file-item-name">${escapeHtml(file.name)}</div>
                <div class="file-item-size">${file.size} · ${file.pages.length} 页</div>
            </div>
            <button class="file-item-remove" onclick="removeFile(${index})" title="移除">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    `).join('');
}

// 移除单个文件
function removeFile(index) {
    state.files.splice(index, 1);
    updateFileList();
    updatePreview();
}

// 清空所有文件
function clearAllFiles() {
    state.files = [];
    updateFileList();
    updatePreview();
}

// 更新预览
function updatePreview() {
    const layout = calculateLayout(state.settings);
    const totalInvoices = getTotalPages();
    const totalPagesNeeded = Math.ceil(totalInvoices / layout.perPage) || 1;

    elements.perPageCount.textContent = layout.perPage;
    elements.totalPages.textContent = totalPagesNeeded;

    // 重置预览页码
    state.currentPreviewPage = 0;
    state.previewCache.clear();

    // 渲染预览
    renderPreviewPage();
}

// 获取预览总页数
function getTotalPreviewPages() {
    const layout = calculateLayout(state.settings);
    const totalInvoices = getTotalPages();
    return Math.ceil(totalInvoices / layout.perPage) || 1;
}

// 渲染预览页面
// ============================================================================
// 预览渲染
// ============================================================================

// 渲染预览页面
async function renderPreviewPage() {
    const canvas = elements.previewCanvas;
    const ctx = canvas.getContext('2d');
    const { showBorder, showCutLine, showPageNumber } = state.settings;

    const layout = calculateLayout(state.settings);
    const { pageWidth, pageHeight, cellWidth, cellHeight, perPage } = layout;

    // 设置 Canvas 分辨率
    const dpr = window.devicePixelRatio || 1;
    canvas.width = pageWidth * dpr;
    canvas.height = pageHeight * dpr;
    canvas.style.width = pageWidth + 'px';
    canvas.style.height = pageHeight + 'px';
    ctx.scale(dpr, dpr);

    // 白色背景
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, pageWidth, pageHeight);

    const allPages = getAllPages();
    const totalPagesNeeded = getTotalPreviewPages();

    // 更新导航按钮状态
    updatePreviewNavigation(totalPagesNeeded);

    // 没有文件时显示占位符
    if (allPages.length === 0) {
        renderEmptyPlaceholders(ctx, layout);
        return;
    }

    // 显示加载状态
    elements.previewLoading.style.display = 'flex';

    try {
        // 预加载当前页所有图像
        const pageImages = await loadPageImages(allPages, perPage);

        // 绘制所有发票
        for (let i = 0; i < perPage; i++) {
            const invoiceIndex = state.currentPreviewPage * perPage + i;
            if (invoiceIndex >= allPages.length) break;

            const { x, y } = calculateCellPosition(i, layout);
            const pageImage = pageImages[i];

            // 绘制发票图像
            drawInvoiceImageOnCanvas(ctx, pageImage, x, y, cellWidth, cellHeight);

            // 绘制边框和裁剪线
            if (showBorder) drawBorderOnCanvas(ctx, x, y, cellWidth, cellHeight);
            if (showCutLine) drawCutLinesOnCanvas(ctx, x, y, cellWidth, cellHeight);
        }

        // 绘制页码
        if (showPageNumber) {
            drawPageNumberOnCanvas(ctx, pageWidth, pageHeight, state.currentPreviewPage + 1, totalPagesNeeded);
        }
    } finally {
        elements.previewLoading.style.display = 'none';
    }
}

// 更新预览导航按钮状态
function updatePreviewNavigation(totalPages) {
    elements.prevPreviewPage.disabled = state.currentPreviewPage <= 0;
    elements.nextPreviewPage.disabled = state.currentPreviewPage >= totalPages - 1;
    elements.currentPreviewPage.textContent = state.currentPreviewPage + 1;
    elements.totalPreviewPages.textContent = totalPages;
}

// 渲染空占位符
function renderEmptyPlaceholders(ctx, layout) {
    const { perPage } = layout;
    for (let i = 0; i < perPage; i++) {
        const { x, y } = calculateCellPosition(i, layout);
        drawPlaceholderOnCanvas(ctx, x, y, layout.cellWidth, layout.cellHeight, i);
    }
}

// 加载当前页的所有图像
async function loadPageImages(allPages, perPage) {
    const pageImages = [];
    for (let i = 0; i < perPage; i++) {
        const invoiceIndex = state.currentPreviewPage * perPage + i;
        if (invoiceIndex >= allPages.length) break;

        const { fileInfo, page } = allPages[invoiceIndex];
        const pageImage = await getPageImage(fileInfo, page);
        pageImages.push(pageImage);
    }
    return pageImages;
}

// 在 Canvas 上绘制发票图像
function drawInvoiceImageOnCanvas(ctx, pageImage, x, y, cellWidth, cellHeight) {
    try {
        if (pageImage) {
            // 计算缩放和居中
            const imgScale = Math.min(cellWidth / pageImage.width, cellHeight / pageImage.height);
            const scaledWidth = pageImage.width * imgScale;
            const scaledHeight = pageImage.height * imgScale;
            const offsetX = (cellWidth - scaledWidth) / 2;
            const offsetY = (cellHeight - scaledHeight) / 2;

            ctx.drawImage(pageImage, x + offsetX, y + offsetY, scaledWidth, scaledHeight);
        } else {
            // 页面图像加载失败
            drawErrorPlaceholderOnCanvas(ctx, x, y, cellWidth, cellHeight, '加载失败');
        }
    } catch (err) {
        console.error('绘制页面失败:', err);
        drawErrorPlaceholderOnCanvas(ctx, x, y, cellWidth, cellHeight, '绘制失败');
    }
}

// 获取所有页面
function getAllPages() {
    const allPages = [];
    for (const fileInfo of state.files) {
        for (const page of fileInfo.pages) {
            allPages.push({ fileInfo, page });
        }
    }
    return allPages;
}

// 获取页面图像（带缓存）
async function getPageImage(fileInfo, page) {
    const cacheKey = `${fileInfo.name}-${page.pageNum || 'img'}-${page.type}`;

    if (state.previewCache.has(cacheKey)) {
        return state.previewCache.get(cacheKey);
    }

    let image = null;

    if (page.type === 'pdf') {
        image = await renderPdfPageToImage(fileInfo, page.pageNum);
        if (!image) {
            console.warn(`PDF页面渲染返回null: ${fileInfo.name} 第${page.pageNum}页`);
        }
    } else if (page.type === 'ofd-image') {
        image = await loadImage(page.imageData);
        if (!image) {
            console.warn(`OFD图片加载返回null: ${fileInfo.name}`);
        }
    }

    if (image) {
        state.previewCache.set(cacheKey, image);
    }

    return image;
}

// 渲染PDF页面到图像
async function renderPdfPageToImage(fileInfo, pageNum) {
    try {
        const pdf = await pdfjsLib.getDocument({ data: fileInfo.pdfData.slice() }).promise;
        const page = await pdf.getPage(pageNum);

        const viewport = page.getViewport({ scale: RENDER_CONFIG.pdfScale });

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = viewport.width;
        offscreenCanvas.height = viewport.height;

        const ctx = offscreenCanvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);

        await page.render({
            canvasContext: ctx,
            viewport: viewport
        }).promise;

        return offscreenCanvas;
    } catch (err) {
        console.error(`渲染PDF页面失败 (${fileInfo.name} 第${pageNum}页):`, err);
        return null;
    }
}

// 加载图片
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

// 获取总页数
function getTotalPages() {
    return state.files.reduce((sum, file) => sum + file.pages.length, 0);
}

// 步骤导航
function goToStep(step) {
    state.currentStep = step;
    
    // 更新步骤指示器
    document.querySelectorAll('.step').forEach((el, index) => {
        el.classList.remove('active', 'completed');
        if (index + 1 < step) {
            el.classList.add('completed');
        } else if (index + 1 === step) {
            el.classList.add('active');
        }
    });

    // 显示对应面板
    Object.values(panels).forEach(panel => panel.style.display = 'none');
    panels[`step${step}`].style.display = 'block';
    
    // 进入第二步时渲染预览
    if (step === 2) {
        state.currentPreviewPage = 0;
        state.previewCache.clear();
        renderPreviewPage();
    }
}

// 开始合并
// 合并并直接下载
async function mergeAndDownload() {
    if (state.files.length === 0) {
        alert('请先上传发票文件');
        return;
    }

    // 显示处理中的提示
    const message = document.createElement('div');
    message.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #fff;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999;
        text-align: center;
        font-size: 16px;
        color: #333;
    `;
    message.innerHTML = '<div style="margin-bottom: 10px;"><div style="display: inline-block; width: 30px; height: 30px; border: 3px solid #f3f3f3; border-top: 3px solid #1677ff; border-radius: 50%; animation: spin 1s linear infinite;"></div></div><p>正在合并发票...</p>';
    document.body.appendChild(message);

    try {
        // 合并PDF
        await mergePDFs();

        // 直接下载
        if (state.mergedPdfBytes) {
            const blob = new Blob([state.mergedPdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `发票合并_${formatDate(new Date())}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    } catch (error) {
        console.error('合并失败:', error);
        alert('合并失败: ' + error.message);
    } finally {
        // 移除提示
        if (message.parentNode) {
            document.body.removeChild(message);
        }
    }
}

// 合并 PDF
// ============================================================================
// PDF 合并
// ============================================================================

// 合并 PDF
async function mergePDFs() {
    const { PDFDocument, StandardFonts } = PDFLib;
    const { showBorder, showCutLine, showPageNumber } = state.settings;

    const layout = calculateLayout(state.settings);
    const { pageWidth, pageHeight, cellWidth, cellHeight, perPage } = layout;

    const allPages = getAllPages();
    const totalPagesNeeded = Math.ceil(allPages.length / perPage);

    // 创建新的 PDF 文档
    const mergedPdf = await PDFDocument.create();
    const font = await mergedPdf.embedFont(StandardFonts.Helvetica);

    let processed = 0;

    for (let pageIndex = 0; pageIndex < totalPagesNeeded; pageIndex++) {
        const newPage = mergedPdf.addPage([pageWidth, pageHeight]);

        for (let i = 0; i < perPage; i++) {
            const invoiceIndex = pageIndex * perPage + i;
            if (invoiceIndex >= allPages.length) break;

            const { fileInfo, page } = allPages[invoiceIndex];

            // 计算位置 (PDF 坐标系：左下角为原点)
            const { x, y: canvasY } = calculateCellPosition(i, layout);
            const y = pageHeight - layout.marginPt - (Math.floor(i / layout.cols) + 1) * cellHeight - Math.floor(i / layout.cols) * layout.gapPt;

            try {
                // 嵌入发票内容
                await embedInvoiceInPdf(newPage, fileInfo, page, x, y, cellWidth, cellHeight, mergedPdf, PDFDocument);
            } catch (err) {
                console.error('处理页面失败:', err);
            }

            // 绘制边框和裁剪线
            if (showBorder) drawBorderOnPdf(newPage, x, y, cellWidth, cellHeight, PDFLib);
            if (showCutLine) drawCutLinesOnPdf(newPage, x, y, cellWidth, cellHeight, PDFLib);

            processed++;
            updateProgress(processed / allPages.length * 100);
        }

        // 绘制页码
        if (showPageNumber) {
            drawPageNumberOnPdf(newPage, pageWidth, pageIndex + 1, totalPagesNeeded, font, PDFLib);
        }
    }

    // 保存合并后的 PDF
    state.mergedPdfBytes = await mergedPdf.save();
}

// 在 PDF 中嵌入发票内容
async function embedInvoiceInPdf(page, fileInfo, invoicePage, x, y, cellWidth, cellHeight, mergedPdf, PDFDocument) {
    if (invoicePage.type === 'pdf') {
        // 嵌入 PDF 页面
        const srcPdf = await PDFDocument.load(fileInfo.pdfData.slice(), {
            ignoreEncryption: true
        });
        const [embeddedPage] = await mergedPdf.embedPdf(srcPdf, [invoicePage.pageNum - 1]);

        const dims = embeddedPage.scale(1);
        const scale = Math.min(cellWidth / dims.width, cellHeight / dims.height);
        const scaledWidth = dims.width * scale;
        const scaledHeight = dims.height * scale;

        // 居中
        const offsetX = (cellWidth - scaledWidth) / 2;
        const offsetY = (cellHeight - scaledHeight) / 2;

        page.drawPage(embeddedPage, {
            x: x + offsetX,
            y: y + offsetY,
            xScale: scale,
            yScale: scale
        });
    } else if (invoicePage.type === 'ofd-image') {
        // 嵌入图片
        const imageBytes = await fetch(invoicePage.imageData).then(r => r.arrayBuffer());
        let image;
        if (invoicePage.imageData.includes('image/png')) {
            image = await mergedPdf.embedPng(imageBytes);
        } else {
            image = await mergedPdf.embedJpg(imageBytes);
        }

        const scale = Math.min(cellWidth / image.width, cellHeight / image.height);
        const scaledWidth = image.width * scale;
        const scaledHeight = image.height * scale;

        const offsetX = (cellWidth - scaledWidth) / 2;
        const offsetY = (cellHeight - scaledHeight) / 2;

        page.drawImage(image, {
            x: x + offsetX,
            y: y + offsetY,
            width: scaledWidth,
            height: scaledHeight
        });
    }
}

// 更新进度
function updateProgress(percent) {
    // 只有在进度条元素存在时才更新（第3步已移除，但保留此函数以兼容mergePDFs）
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    if (progressFill) progressFill.style.width = percent + '%';
    if (progressText) progressText.textContent = Math.round(percent) + '%';
}

// 打印当前预览页面
async function printCurrentPage() {
    if (state.files.length === 0) {
        alert('请先上传发票文件');
        return;
    }

    try {
        // 先合并PDF
        await mergePDFs();
        
        if (!state.mergedPdfBytes) {
            alert('合并PDF失败');
            return;
        }

        // 创建PDF blob URL并在隐藏iframe中打开
        const blob = new Blob([state.mergedPdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        
        // 创建隐藏的iframe
        let printFrame = document.getElementById('print-frame');
        if (!printFrame) {
            printFrame = document.createElement('iframe');
            printFrame.id = 'print-frame';
            printFrame.style.display = 'none';
            document.body.appendChild(printFrame);
        }
        
        // 在iframe中加载PDF
        printFrame.src = url;
        
        // 等待iframe加载完成后打印
        printFrame.onload = function() {
            try {
                const iframeWindow = printFrame.contentWindow;
                iframeWindow.print();
            } catch (err) {
                console.error('iframe打印失败:', err);
                window.print();
            }
        };
        
        // 清理：打印对话框关闭后释放资源
        const afterPrintHandler = function() {
            window.removeEventListener('afterprint', afterPrintHandler);
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 500);
        };
        
        window.addEventListener('afterprint', afterPrintHandler);
        
    } catch (error) {
        console.error('打印失败:', error);
        alert('打印失败: ' + error.message);
    }
}

// 下载合并后的 PDF
// 工具函数
// ============================================================================
// 工具函数
// ============================================================================

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(date) {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 启动应用
init();

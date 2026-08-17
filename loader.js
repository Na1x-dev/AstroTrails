// Пошаговое чтение пачки видеофайлов в режиме реального времени
document.getElementById('processBtn').addEventListener('click', async () => {
    if (!window.astroState.videoFiles || window.astroState.videoFiles.length === 0) return;

    if (window.toggleUIBlock) window.toggleUIBlock(true);
    
    const canvas = document.getElementById('glCanvas');
    
    // КРИТИЧЕСКИЙ ФИКС: Принудительно ПОКАЗЫВАЕМ оверлей при повторном старте
    const overlay = document.getElementById('statusOverlay');
    if (overlay) {
        overlay.classList.remove('hidden');
    }

    const oldIcon = document.getElementById('statusIcon');
    if (oldIcon) oldIcon.style.display = 'none';
    
    const spinner = document.getElementById('loaderSpinner');
    if (spinner) {
        spinner.className = 'google-spinner';
        spinner.style.display = 'block';
    }

    // Выставляем четкие стартовые надписи
    document.getElementById('statusTitle').textContent = 'Идет обработка видео';
    document.getElementById('statusText').textContent = 'Пожалуйста, подождите...';

    window.astroState.cachedFrames = [];
    const files = window.astroState.videoFiles;

    for (let fIdx = 0; fIdx < files.length; fIdx++) {
        if (files.length > 1) {
            document.getElementById('statusTitle').textContent = `Обработка видео: клип ${fIdx + 1} из ${files.length}`;
        }
        
        const video = document.createElement('video');
        const videoUrl = URL.createObjectURL(files[fIdx]);
        
        video.muted = true; 
        video.playsInline = true;
        video.crossOrigin = "anonymous";
        video.src = videoUrl;

        await new Promise((resolve) => {
            video.oncanplaythrough = resolve;
            video.load();
        });

        if (fIdx === 0) {
            canvas.width = video.videoWidth || 1920;
            canvas.height = video.videoHeight || 1080;
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width; 
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        video.play();

        await new Promise((resolve) => {
            const trackInterval = setInterval(async () => {
                if (video.paused || video.ended) {
                    clearInterval(trackInterval);
                    resolve();
                    return;
                }

                tempCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
                
                const frameCopy = document.createElement('canvas');
                frameCopy.width = canvas.width;
                frameCopy.height = canvas.height;
                frameCopy.getContext('2d').drawImage(tempCanvas, 0, 0);
                
                window.astroState.cachedFrames.push(frameCopy);
            }, 40); 
            
            video.onended = () => {
                clearInterval(trackInterval);
                resolve();
            };
        });

        URL.revokeObjectURL(videoUrl);
    }

    if (window.renderCompositeTracks) {
        window.renderCompositeTracks();
    }
});

// Алгоритм наложения сглаживания треков (Интеллектуальный Gap Filling)
window.renderCompositeTracks = function() {
    if (!window.astroState.cachedFrames || window.astroState.cachedFrames.length === 0) return;

    const canvas = document.getElementById('glCanvas');
    const ctx = canvas.getContext('2d');
    const startOpacityInput = document.getElementById('startOpacity');

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const total = window.astroState.cachedFrames.length;
    const sliderVal = parseFloat(startOpacityInput.value);
    const powerCoefficient = Math.pow(1.06, sliderVal) - 0.9;

    for (let i = 0; i < total; i++) {
        const progress = i / (total - 1 || 1);
        const opacity = Math.pow(progress, powerCoefficient);

        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = 'lighten';
        
        ctx.drawImage(window.astroState.cachedFrames[i], 0, 0);
        
        if (i > 0) {
            ctx.globalAlpha = opacity * 0.4;
            ctx.drawImage(window.astroState.cachedFrames[i], -0.5, -0.5); 
        }
        ctx.restore();
    }

    window.astroState.rawCompositeBuffer = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const previewWidth = Math.min(canvas.width, 1024);
    const previewHeight = (canvas.height / canvas.width) * previewWidth;
    const pCanvas = document.createElement('canvas');
    pCanvas.width = previewWidth; 
    pCanvas.height = previewHeight;
    pCanvas.getContext('2d').drawImage(canvas, 0, 0, previewWidth, previewHeight);
    window.astroState.previewBuffer = pCanvas.getContext('2d').getImageData(0, 0, previewWidth, previewHeight);

    if (window.applyPostProcessing) {
        window.applyPostProcessing();
    }

    // Рендер закончен — чисто и надежно убираем экран загрузки
    document.getElementById('statusOverlay').classList.add('hidden');
    document.getElementById('loaderSpinner').style.display = 'none';
    
    if (window.toggleUIBlock) window.toggleUIBlock(false);
    document.getElementById('secEffects').classList.remove('disabled-control');
    if (window.toggleFiltersState) window.toggleFiltersState(false);
    document.getElementById('downloadBtn').disabled = false;
    document.getElementById('resetBtn').disabled = false;
    
    // Блокируем кнопку до выбора новых файлов
    document.getElementById('processBtn').disabled = true; 
};

// Склеивание оригинальных MP4 по байтам (Blob Concat)
document.getElementById('downloadVideoBtn').addEventListener('click', () => {
    if (!window.astroState.videoFiles || window.astroState.videoFiles.length < 2) return;
    
    const videoBlob = new Blob(window.astroState.videoFiles, { type: 'video/mp4' });
    const url = URL.createObjectURL(videoBlob);
    
    const a = document.createElement('a');
    a.href = url; 
    a.download = `Combined_AstroTimelapse_${Date.now()}.mp4`;
    a.click();
    
    setTimeout(() => URL.revokeObjectURL(url), 100);
});

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

        await video.play().catch((error) => { throw new Error('Браузер не смог запустить декодирование видео: ' + error.message); });

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

// Корректное объединение клипов: декодирование и повторная запись в единый WebM.
// Простое соединение MP4-файлов через Blob не создаёт валидный видеоконтейнер.
document.getElementById('downloadVideoBtn').addEventListener('click', async () => {
    const files = window.astroState.videoFiles || [];
    if (files.length < 2 || !window.MediaRecorder) {
        alert('Объединение видео недоступно в этом браузере. Попробуйте актуальную версию Chrome, Edge или Firefox.');
        return;
    }
    const canvas = document.createElement('canvas');
    const firstUrl = URL.createObjectURL(files[0]);
    const probe = document.createElement('video');
    probe.muted = true;
    probe.preload = 'metadata';
    probe.src = firstUrl;
    try {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Не удалось прочитать первое видео.')), 20000);
            probe.onloadedmetadata = () => { clearTimeout(timeout); resolve(); };
            probe.onerror = () => { clearTimeout(timeout); reject(new Error('Формат первого видео не поддерживается.')); };
        });
        const scale = Math.min(1, 1920 / Math.max(probe.videoWidth || 1920, probe.videoHeight || 1080));
        canvas.width = Math.max(1, Math.round((probe.videoWidth || 1920) * scale));
        canvas.height = Math.max(1, Math.round((probe.videoHeight || 1080) * scale));
    } catch (error) {
        URL.revokeObjectURL(firstUrl);
        alert(error.message);
        return;
    }
    URL.revokeObjectURL(firstUrl);
    const ctx = canvas.getContext('2d');
    const mime = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']
        .find(type => MediaRecorder.isTypeSupported(type));
    if (!mime || !canvas.captureStream) {
        alert('Этот браузер не поддерживает экспорт объединённого WebM-видео.');
        return;
    }
    const button = document.getElementById('downloadVideoBtn');
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Объединение…';
    const stream = canvas.captureStream(30);
    const chunks = [];
    let recorder;
    try {
        recorder = new MediaRecorder(stream, { mimeType: mime });
        recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
        const stopped = new Promise((resolve, reject) => {
            recorder.onstop = resolve;
            recorder.onerror = event => reject(event.error || new Error('Ошибка записи видео.'));
        });
        recorder.start(1000);
        for (let index = 0; index < files.length; index++) {
            const video = document.createElement('video');
            const url = URL.createObjectURL(files[index]);
            video.muted = true;
            video.playsInline = true;
            video.preload = 'auto';
            video.src = url;
            try {
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Тайм-аут: ' + files[index].name)), 30000);
                    video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
                    video.onerror = () => { clearTimeout(timeout); reject(new Error('Не удалось открыть: ' + files[index].name)); };
                });
                const draw = () => {
                    if (!video.paused && !video.ended) {
                        ctx.fillStyle = '#000';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        const ratio = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
                        const w = video.videoWidth * ratio, h = video.videoHeight * ratio;
                        ctx.drawImage(video, (canvas.width-w)/2, (canvas.height-h)/2, w, h);
                        requestAnimationFrame(draw);
                    }
                };
                await video.play();
                draw();
                await new Promise(resolve => { video.onended = resolve; });
            } finally {
                video.pause();
                video.removeAttribute('src');
                video.load();
                URL.revokeObjectURL(url);
            }
            button.textContent = 'Клип ' + (index + 1) + ' из ' + files.length;
        }
        recorder.stop();
        await stopped;
        const blob = new Blob(chunks, { type: mime });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'Combined_AstroTrails_' + Date.now() + '.webm';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        alert('Не удалось объединить видео: ' + (error.message || 'неизвестная ошибка'));
    } finally {
        stream.getTracks().forEach(track => track.stop());
        button.disabled = false;
        button.textContent = originalLabel;
    }
});

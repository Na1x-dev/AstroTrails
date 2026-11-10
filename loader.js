// Потоковая обработка видео: кадры сразу накладываются на один холст.
// В памяти не сохраняются отдельные Canvas для каждого кадра.
let activeVideoJob = false;

function waitForVideoMetadata(video, file, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            video.removeEventListener('loadedmetadata', onReady);
            video.removeEventListener('error', onError);
            if (error) reject(error);
            else resolve();
        };
        const onReady = () => finish();
        const onError = () => finish(new Error('Не удалось открыть видео: ' + file.name));
        const timer = setTimeout(() => finish(new Error('Тайм-аут при чтении видео: ' + file.name)), timeoutMs);
        video.addEventListener('loadedmetadata', onReady, { once: true });
        video.addEventListener('error', onError, { once: true });
        video.load();
    });
}

function drawTrailFrame(ctx, video, opacity, width, height, addSoftPass) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighten';
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
    ctx.drawImage(video, 0, 0, width, height);
    // Небольшой дополнительный проход оставляет прежнее мягкое сглаживание следа.
    if (addSoftPass) {
        ctx.globalAlpha = Math.max(0, Math.min(1, opacity * 0.4));
        ctx.drawImage(video, -0.5, -0.5, width, height);
    }
    ctx.restore();
}

function playAndComposite(video, ctx, width, height, durationBefore, totalDuration, powerCoefficient) {
    return new Promise((resolve, reject) => {
        let finished = false;
        let callbackId = null;
        let rafId = null;
        let lastMediaTime = -1;
        let frameCount = 0;
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const timeout = setTimeout(() => finish(new Error('Обработка видео превысила допустимое время.')), Math.max(60000, (duration + 30) * 1000));

        const cleanup = () => {
            clearTimeout(timeout);
            video.removeEventListener('ended', onEnded);
            video.removeEventListener('error', onError);
            if (callbackId !== null && video.cancelVideoFrameCallback) {
                try { video.cancelVideoFrameCallback(callbackId); } catch (_) {}
            }
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
        const finish = (error) => {
            if (finished) return;
            finished = true;
            cleanup();
            if (error) reject(error);
            else resolve(frameCount);
        };
        const onEnded = () => finish();
        const onError = () => finish(new Error('Ошибка декодирования видео.'));
        const render = (mediaTime) => {
            if (!Number.isFinite(mediaTime) || mediaTime < 0) mediaTime = video.currentTime || 0;
            if (mediaTime > lastMediaTime + 0.0005) {
                lastMediaTime = mediaTime;
                const progress = Math.max(0, Math.min(1, (durationBefore + mediaTime) / Math.max(totalDuration, 0.001)));
                const opacity = Math.pow(progress, powerCoefficient);
                drawTrailFrame(ctx, video, opacity, width, height, frameCount > 0);
                frameCount++;
            }
        };
        const onVideoFrame = (_now, metadata) => {
            if (finished) return;
            render(metadata && Number.isFinite(metadata.mediaTime) ? metadata.mediaTime : video.currentTime);
            if (!video.ended) callbackId = video.requestVideoFrameCallback(onVideoFrame);
        };
        const onAnimationFrame = () => {
            if (finished) return;
            render(video.currentTime);
            if (!video.ended && !video.paused) rafId = requestAnimationFrame(onAnimationFrame);
        };

        video.addEventListener('ended', onEnded, { once: true });
        video.addEventListener('error', onError, { once: true });
        video.play().then(() => {
            if (typeof video.requestVideoFrameCallback === 'function') {
                callbackId = video.requestVideoFrameCallback(onVideoFrame);
            } else {
                rafId = requestAnimationFrame(onAnimationFrame);
            }
        }).catch(error => finish(new Error('Браузер не смог запустить видео: ' + error.message)));
    });
}

function finalizeVideoComposite(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    window.astroState.rawCompositeBuffer = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const previewWidth = Math.min(canvas.width, 1024);
    const previewHeight = Math.max(1, Math.round(canvas.height * previewWidth / canvas.width));
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = previewWidth;
    previewCanvas.height = previewHeight;
    previewCanvas.getContext('2d').drawImage(canvas, 0, 0, previewWidth, previewHeight);
    window.astroState.previewBuffer = previewCanvas.getContext('2d', { willReadFrequently: true })
        .getImageData(0, 0, previewWidth, previewHeight);

    if (window.applyPostProcessing) window.applyPostProcessing();
    document.getElementById('statusOverlay').classList.add('hidden');
    document.getElementById('loaderSpinner').style.display = 'none';
    if (window.toggleUIBlock) window.toggleUIBlock(false);
    document.getElementById('secEffects').classList.remove('disabled-control');
    if (window.toggleFiltersState) window.toggleFiltersState(false);
    document.getElementById('downloadBtn').disabled = false;
    document.getElementById('resetBtn').disabled = false;
    document.getElementById('processBtn').disabled = false;
    window.astroState.generatedOpacity = Number(document.getElementById('startOpacity').value);
    document.getElementById('processBtn').innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Пересчитать треки';
}

document.getElementById('processBtn').addEventListener('click', async () => {
    const files = (window.astroState && window.astroState.videoFiles) || [];
    if (!files.length || activeVideoJob) return;
    activeVideoJob = true;
    if (window.toggleUIBlock) window.toggleUIBlock(true);

    const canvas = document.getElementById('glCanvas');
    const overlay = document.getElementById('statusOverlay');
    const title = document.getElementById('statusTitle');
    const message = document.getElementById('statusText');
    const spinner = document.getElementById('loaderSpinner');
    overlay.classList.remove('hidden');
    document.getElementById('statusIcon').style.display = 'none';
    spinner.className = 'google-spinner';
    spinner.style.display = 'block';
    title.textContent = 'Подготовка видео';
    message.textContent = 'Проверяем длительность и параметры клипов…';

    window.astroState.cachedFrames = [];
    // Храним последний успешный результат до завершения новой генерации.
    const previousResult = {
        raw: window.astroState.rawCompositeBuffer,
        preview: window.astroState.previewBuffer,
        opacity: window.astroState.generatedOpacity
    };
    const videos = [];
    const urls = [];
    try {
        let totalDuration = 0;
        // Сначала читаем только метаданные. Декодируется в каждый момент лишь один клип.
        for (let i = 0; i < files.length; i++) {
            title.textContent = 'Подготовка клипа ' + (i + 1) + ' из ' + files.length;
            const video = document.createElement('video');
            const url = URL.createObjectURL(files[i]);
            videos.push(video);
            urls.push(url);
            video.muted = true;
            video.playsInline = true;
            video.preload = 'metadata';
            video.src = url;
            await waitForVideoMetadata(video, files[i]);
            if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration) || video.duration <= 0) {
                throw new Error('У видео нет корректных размеров или длительности: ' + files[i].name);
            }
            totalDuration += video.duration;
        }

        const first = videos[0];
        const maxSide = window.matchMedia('(max-width: 768px)').matches ? 1440 : 2048;
        const scale = Math.min(1, maxSide / Math.max(first.videoWidth, first.videoHeight));
        canvas.width = Math.max(1, Math.round(first.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(first.videoHeight * scale));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const sliderValue = Number(document.getElementById('startOpacity').value);
        const powerCoefficient = Math.max(0.05, Math.pow(1.06, sliderValue) - 0.9);
        let durationBefore = 0;
        for (let i = 0; i < videos.length; i++) {
            const video = videos[i];
            title.textContent = 'Обработка видео: клип ' + (i + 1) + ' из ' + videos.length;
            message.textContent = 'Кадры сразу накладываются на итоговый холст — без накопления в памяти.';
            // Для повторного клипа сбрасываем позицию после чтения метаданных.
            video.currentTime = 0;
            await new Promise((resolve, reject) => {
                if (video.readyState >= 2) return resolve();
                const timer = setTimeout(() => reject(new Error('Не удалось подготовить кадры: ' + files[i].name)), 20000);
                video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
                video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Ошибка чтения кадров: ' + files[i].name)); }, { once: true });
            });
            await playAndComposite(video, ctx, canvas.width, canvas.height, durationBefore, totalDuration, powerCoefficient);
            durationBefore += video.duration;
            video.pause();
        }

        finalizeVideoComposite(canvas);
        title.textContent = 'Обработка завершена';
        message.textContent = 'Световые следы созданы. При изменении прозрачности нажмите «Пересчитать треки».';
    } catch (error) {
        title.textContent = 'Не удалось обработать видео';
        message.textContent = error.message || 'Произошла ошибка при чтении видео.';
        document.getElementById('statusIcon').style.display = '';
        document.getElementById('statusIcon').className = 'fa-solid fa-circle-exclamation overlay-icon';
        spinner.style.display = 'none';
        overlay.classList.remove('hidden');
        if (window.toggleUIBlock) window.toggleUIBlock(false);
        if (previousResult.raw && previousResult.preview) {
            window.astroState.rawCompositeBuffer = previousResult.raw;
            window.astroState.previewBuffer = previousResult.preview;
            window.astroState.generatedOpacity = previousResult.opacity;
            if (window.applyPostProcessing) window.applyPostProcessing();
            document.getElementById('downloadBtn').disabled = false;
            overlay.classList.add('hidden');
        }
        document.getElementById('processBtn').disabled = false;
    } finally {
        videos.forEach(video => {
            try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {}
        });
        urls.forEach(url => URL.revokeObjectURL(url));
        activeVideoJob = false;
    }
});

// Финализация также оставлена глобальной для совместимости со старым интерфейсом.
window.renderCompositeTracks = function() {
    // Кадры намеренно больше не хранятся; повторная обработка запускается кнопкой.
    return false;
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

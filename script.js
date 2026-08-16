window.astroState = {
    videoFile: null,
    cachedFrames: [],
    rawCompositeBuffer: null, // Полноразмерный чистый буфер треков
    previewBuffer: null       // Быстрый уменьшенный буфер для предпросмотра
};

const videoInput = document.getElementById('videoInput');
const uploadBtnClick = document.getElementById('uploadBtnClick');
const fileInfoText = document.getElementById('fileInfoText');
const dropZone = document.getElementById('dropZone');
const startOpacityInput = document.getElementById('startOpacity');
const opacityVal = document.getElementById('opacityVal');
const processBtn = document.getElementById('processBtn');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');

// glCanvas теперь выступает как основной видимый 2D холст
const canvas = document.getElementById('glCanvas');
const ctx = canvas.getContext('2d');

function enhanceSlider(input, onInputCallback) {
    const wrapper = document.createElement('div');
    wrapper.className = 'slider-controls';
    input.parentNode.insertBefore(wrapper, input);

    const btnMinus = document.createElement('button');
    btnMinus.className = 'btn-step';
    btnMinus.innerHTML = '-';
    btnMinus.type = 'button';

    const btnPlus = document.createElement('button');
    btnPlus.className = 'btn-step';
    btnPlus.innerHTML = '+';
    btnPlus.type = 'button';

    wrapper.appendChild(btnMinus);
    wrapper.appendChild(input);
    wrapper.appendChild(btnPlus);

    const changeVal = (delta) => {
        if (input.disabled) return;
        const min = parseFloat(input.min);
        const max = parseFloat(input.max);
        let val = parseFloat(input.value) + delta;
        if (val < min) val = min;
        if (val > max) val = max;
        input.value = val;
        input.dispatchEvent(new Event('input'));
    };

    btnMinus.addEventListener('click', () => changeVal(-1));
    btnPlus.addEventListener('click', () => changeVal(1));

    wrapper.addEventListener('wheel', (e) => {
        if (input.disabled) return;
        e.preventDefault();
        changeVal(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
}

// Инициализируем улучшение для слайдера трасс
enhanceSlider(startOpacityInput);

startOpacityInput.addEventListener('input', (e) => {
    opacityVal.textContent = e.target.value + '%';
    if (window.astroState.cachedFrames.length > 0) renderCompositeTracks();
});

resetBtn.addEventListener('click', () => {
    startOpacityInput.value = 20;
    opacityVal.textContent = '20%';
    if (window.resetAllEffects) window.resetAllEffects(); // Сбросит фильтры в effects.js и перерисует холст
    renderCompositeTracks(); // Пересчитает длину треков звезд под 20%
});


['dragenter', 'dragover'].forEach(name => {
    dropZone.addEventListener(name, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
});
['dragleave', 'drop'].forEach(name => {
    dropZone.addEventListener(name, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
});
dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files[0]); });
uploadBtnClick.addEventListener('click', () => videoInput.click());
videoInput.addEventListener('change', (e) => { if (e.target.files.length) handleFiles(e.target.files[0]); });

function handleFiles(files) {
    if (!files || files.length === 0) return;
    
    // ИСПРАВЛЕНИЕ: Извлекаем первый конкретный файл из коллекции FileList, 
    // независимо от того, пришел он через клик или через Drag & Drop
    const file = files instanceof FileList ? files[0] : files;

    // ПРОВЕРКА ФОРМАТА: Проверяем MIME-тип или расширение файла
    const isVideo = file.type.startsWith('video/') || 
                    file.name.toLowerCase().endsWith('.mp4') || 
                    file.name.toLowerCase().endsWith('.mov') || 
                    file.name.toLowerCase().endsWith('.avi');

    if (!isVideo) {
        // Выводим ошибку в центральный оверлей
        const icon = document.getElementById('statusIcon');
        icon.style.display = 'block';
        icon.className = "fa-solid fa-circle-exclamation overlay-icon";
        icon.style.color = "#f87171"; // Красный цвет ошибки
        
        document.getElementById('statusTitle').textContent = "Неподдерживаемый формат";
        document.getElementById('statusText').textContent = `Файл "${file.name}" не является видео. Пожалуйста, загрузите склеенный таймлапс в формате MP4, MOV или AVI.`;
        document.getElementById('statusOverlay').classList.remove('hidden');
        
        // Блокируем инструменты
        fileInfoText.textContent = "Ошибка загрузки";
        secTracks.classList.add('disabled-control');
        startOpacityInput.disabled = true;
        processBtn.disabled = true;
        return;
    }

    // ЕСЛИ ВСЁ ХОРОШО — загружаем видеофайл
    window.astroState.videoFile = file;
    fileInfoText.textContent = file.name;
    
    if(window.astroState.cachedFrames.length) {
        window.astroState.cachedFrames.forEach(bitmap => {
            if (bitmap && typeof bitmap.close === 'function') bitmap.close();
        });
    }
    window.astroState.cachedFrames = []; 
    window.astroState.rawCompositeBuffer = null;
    window.astroState.previewBuffer = null;

    // Сбрасываем цвет иконки к дефолтному
    document.getElementById('statusIcon').style.color = ""; 

    secTracks.classList.remove('disabled-control');
    startOpacityInput.disabled = false;
    processBtn.disabled = false;
    resetBtn.disabled = true;
    
    startOpacityInput.parentNode.querySelectorAll('.btn-step').forEach(b => b.disabled = false);

    const icon = document.getElementById('statusIcon');
    icon.style.display = 'block';
    icon.className = "fa-solid fa-circle-play overlay-icon";
    document.getElementById('statusTitle').textContent = "Видео готово к разбору";
    document.getElementById('statusText').textContent = "Нажмите кнопку «Сгенерировать треки», чтобы разбить таймлапс на звездные дорожки.";
    document.getElementById('statusOverlay').classList.remove('hidden');
    downloadBtn.disabled = true;
    secEffects.classList.add('disabled-control');
    if (window.toggleFiltersState) window.toggleFiltersState(true);
}

processBtn.addEventListener('click', async () => {
    if (!window.astroState.videoFile) return;

    toggleUIBlock(true);
    document.getElementById('statusIcon').style.display = 'none';
    document.getElementById('loaderSpinner').style.display = 'block';
    document.getElementById('statusTitle').textContent = "Идет импорт кадров в кэш...";
    document.getElementById('progressContainer').style.display = 'block';
    document.getElementById('progressBar').style.width = '0%';

    const video = document.createElement('video');
    video.src = URL.createObjectURL(window.astroState.videoFile);
    video.muted = true; video.playsInline = true;

    video.onloadedmetadata = async () => {
        // Устанавливаем размер холста под видео
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const duration = video.duration;
        const fps = 25;
        const totalFrames = Math.floor(duration * fps);
        const step = duration / totalFrames;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        window.astroState.cachedFrames = [];
        const maxAllowedFrames = 120;
        const frameSkip = Math.max(1, Math.floor(totalFrames / maxAllowedFrames));

        for (let i = 0; i < totalFrames; i += frameSkip) {
            video.currentTime = i * step;
            await new Promise(r => video.onseeked = r);

            tempCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const bitmap = await createImageBitmap(tempCanvas);
            window.astroState.cachedFrames.push(bitmap);

            const percent = Math.round((i / totalFrames) * 100);
            document.getElementById('progressBar').style.width = `${percent}%`;
            document.getElementById('statusText').textContent = `Чтение потока: ${percent}% (Кадр ${i}/${totalFrames})`;
        }

        renderCompositeTracks();
    };
});

function renderCompositeTracks() {
    if (window.astroState.cachedFrames.length === 0) return;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const total = window.astroState.cachedFrames.length;

const sliderVal = parseFloat(startOpacityInput.value);
// Ограничиваем максимальную степень, чтобы она не уходила в бесконечность
const powerCoefficient = 0.1 + (sliderVal / 25); 

// Внутри цикла рисования кадров:


    const factor = sliderVal / 100;


    // Экспоненциальная зависимость длины хвоста кометы


    // Временный холст для сборки треков
    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = canvas.width;
    layerCanvas.height = canvas.height;
    const layerCtx = layerCanvas.getContext('2d');

    for (let i = 0; i < total; i++) {
        const progress = i / (total - 1 || 1);
        const opacity = Math.pow(progress, powerCoefficient);

        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.globalCompositeOperation = 'lighten';
        ctx.drawImage(window.astroState.cachedFrames[i], 0, 0);
        ctx.restore();
    }

    // Сохраняем чистый полноразмерный буфер треков звезд
    window.astroState.rawCompositeBuffer = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // СОЗДАЕМ ОПТИМИЗИРОВАННЫЙ ТРЕК-ПРЕВЬЮ (Прокси-картинка для быстрой цветокоррекции)
    const previewWidth = Math.min(canvas.width, 1024);
    const previewHeight = (canvas.height / canvas.width) * previewWidth;

    const pCanvas = document.createElement('canvas');
    pCanvas.width = previewWidth;
    pCanvas.height = previewHeight;
    const pCtx = pCanvas.getContext('2d');
    pCtx.drawImage(canvas, 0, 0, previewWidth, previewHeight);

    window.astroState.previewBuffer = pCtx.getImageData(0, 0, previewWidth, previewHeight);

    // Применяем фильтры
    if (window.applyPostProcessing) window.applyPostProcessing();

    document.getElementById('statusOverlay').classList.add('hidden');
    toggleUIBlock(false);
    secEffects.classList.remove('disabled-control');
    if (window.toggleFiltersState) window.toggleFiltersState(false);
    downloadBtn.disabled = false;
    resetBtn.disabled = false;
}

function toggleUIBlock(isBlocked) {
    processBtn.disabled = isBlocked;
    uploadBtnClick.disabled = isBlocked;
    startOpacityInput.disabled = isBlocked;
    dropZone.style.pointerEvents = isBlocked ? 'none' : 'auto';
    startOpacityInput.parentNode.querySelectorAll('.btn-step').forEach(b => b.disabled = isBlocked);

    if (isBlocked) {
        document.getElementById('loaderSpinner').style.display = 'block';
        resetBtn.disabled = true;
    } else {
        document.getElementById('loaderSpinner').style.display = 'none';
        document.getElementById('progressContainer').style.display = 'none';
    }
}

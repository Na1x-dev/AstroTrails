window.astroState = {
    videoFiles: [], // Список пачки видео
    cachedFrames: [], // Кэш кадров в ОЗУ
    rawCompositeBuffer: null, 
    previewBuffer: null       
};

const videoInput = document.getElementById('videoInput');
const uploadBtnClick = document.getElementById('uploadBtnClick');
const fileInfoText = document.getElementById('fileInfoText');
const dropZone = document.getElementById('dropZone'); 
const startOpacityInput = document.getElementById('startOpacity');
const opacityVal = document.getElementById('opacityVal');
const processBtn = document.getElementById('processBtn');
const downloadBtn = document.getElementById('downloadBtn');
const downloadVideoBtn = document.getElementById('downloadVideoBtn');
const resetBtn = document.getElementById('resetBtn');
const tutorialBlock = document.getElementById('tutorialBlock');
const closeTutorialBtn = document.getElementById('closeTutorialBtn');

const canvas = document.getElementById('glCanvas');
const ctx = canvas.getContext('2d');

if (closeTutorialBtn && tutorialBlock) {
    closeTutorialBtn.addEventListener('click', () => {
        tutorialBlock.style.display = 'none';
    });
}

window.enhanceSlider = function(input) {
    const wrapper = document.createElement('div');
    wrapper.className = 'slider-controls';
    input.parentNode.insertBefore(wrapper, input);
    
    const btnMinus = document.createElement('button');
    btnMinus.className = 'btn-step'; btnMinus.innerHTML = '-'; btnMinus.type = 'button';
    const btnPlus = document.createElement('button');
    btnPlus.className = 'btn-step'; btnPlus.innerHTML = '+'; btnPlus.type = 'button';
    
    wrapper.appendChild(btnMinus); wrapper.appendChild(input); wrapper.appendChild(btnPlus);
    
    const changeVal = (delta) => {
        if (input.disabled) return;
        let val = parseFloat(input.value) + delta;
        if (val < parseFloat(input.min)) val = parseFloat(input.min);
        if (val > parseFloat(input.max)) val = parseFloat(input.max);
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
};

window.enhanceSlider(startOpacityInput);

startOpacityInput.addEventListener('input', (e) => {
    opacityVal.textContent = e.target.value + '%';
    if(window.astroState.cachedFrames.length > 0 && window.renderCompositeTracks) {
        window.renderCompositeTracks(); 
    }
});

resetBtn.addEventListener('click', () => {
    startOpacityInput.value = 20; 
    opacityVal.textContent = '20%';
    if (window.resetAllEffects) window.resetAllEffects();
    if (window.renderCompositeTracks) window.renderCompositeTracks();
});

['dragenter', 'dragover'].forEach(name => { 
    dropZone.addEventListener(name, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); }); 
});
['dragleave', 'drop'].forEach(name => { 
    dropZone.addEventListener(name, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); }); 
});
dropZone.addEventListener('drop', (e) => { 
    e.preventDefault(); 
    if(e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); 
});

uploadBtnClick.addEventListener('click', () => videoInput.click());
videoInput.addEventListener('change', (e) => { 
    if(e.target.files.length) handleFiles(e.target.files); 
});

function handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    
    const filesArray = Array.from(fileList).filter(f => 
        f.type.startsWith('video/') || f.name.toLowerCase().endsWith('.mp4') || f.name.toLowerCase().endsWith('.mov')
    );

    if (filesArray.length === 0) {
        document.getElementById('statusIcon').className = "fa-solid fa-circle-exclamation overlay-icon";
        document.getElementById('statusTitle').textContent = "Формат не поддерживается";
        document.getElementById('statusText').textContent = "Пожалуйста, выберите корректные файлы видео (MP4, MOV, AVI).";
        return;
    }

    filesArray.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));

    // КРИТИЧЕСКИЙ ФИКС ОЧИСТКИ КЭША: Начисто стираем старые кадры из ОЗУ ноутбука перед загрузкой новых
    if(window.astroState.cachedFrames.length) {
        window.astroState.cachedFrames.forEach(b => { if(b && b.close) b.close(); });
    }
    window.astroState.cachedFrames = []; 
    window.astroState.rawCompositeBuffer = null;
    window.astroState.previewBuffer = null;

    window.astroState.videoFiles = filesArray;
    fileInfoText.textContent = `Загружено видео: ${filesArray.length} шт.`;

    secTracks.classList.remove('disabled-control');
    startOpacityInput.disabled = false;
    processBtn.disabled = false; // Разблокируем кнопку, так как пришли новые файлы

    if (filesArray.length >= 2) {
        downloadVideoBtn.style.display = 'inline-flex';
        downloadVideoBtn.disabled = false;
    } else {
        downloadVideoBtn.style.display = 'none';
        downloadVideoBtn.disabled = true;
    }

    document.getElementById('statusIcon').className = "fa-solid fa-circle-play overlay-icon";
    document.getElementById('statusTitle').textContent = "Пакет видео загружен";
    document.getElementById('statusText').textContent = `Сортировка выполнена успешно. Всего видеоклипов: ${filesArray.length}. Нажмите кнопку «Сгенерировать треки».`;
}

window.toggleUIBlock = function(isBlocked) {
    processBtn.disabled = isBlocked;
    uploadBtnClick.disabled = isBlocked;
    startOpacityInput.disabled = isBlocked;
    downloadVideoBtn.disabled = isBlocked;
    dropZone.style.pointerEvents = isBlocked ? 'none' : 'auto';
    startOpacityInput.parentNode.querySelectorAll('.btn-step').forEach(b => b.disabled = isBlocked);

    if(isBlocked) {
        resetBtn.disabled = true;
    } else {
        document.getElementById('progressContainer').style.display = 'none';
    }
};


// --- Режим наложения фотографий ---
(() => {
    const importCard = uploadBtnClick.closest('.section-card');
    const photoInput = document.createElement('input');
    photoInput.type = 'file';
    photoInput.accept = 'image/*';
    photoInput.multiple = true;
    photoInput.hidden = true;
    photoInput.id = 'photoInput';
    importCard.appendChild(photoInput);

    const photoBtn = document.createElement('button');
    photoBtn.type = 'button';
    photoBtn.className = 'btn btn-tonal photo-upload-btn';
    photoBtn.style.marginTop = '8px';
    photoBtn.innerHTML = '<span aria-hidden="true">▧</span> Добавить фотографии (до 300)';
    uploadBtnClick.insertAdjacentElement('afterend', photoBtn);

    const photoProcessBtn = document.createElement('button');
    photoProcessBtn.type = 'button';
    photoProcessBtn.className = 'btn btn-primary';
    photoProcessBtn.style.marginTop = '8px';
    photoProcessBtn.textContent = 'Создать фотокомпозицию';
    photoProcessBtn.disabled = true;
    photoBtn.insertAdjacentElement('afterend', photoProcessBtn);

    const photoState = { files: [], busy: false };\n    const decodePhoto = file => {\n        if (window.createImageBitmap) return window.createImageBitmap(file);\n        return new Promise((resolve, reject) => {\n            const image = new Image();\n            const url = URL.createObjectURL(file);\n            image.onload = () => { URL.revokeObjectURL(url); resolve(image); };\n            image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')); };\n            image.src = url;\n        });\n    };
    window.astroState.photoFiles = photoState.files;

    photoBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', () => {
        const selected = Array.from(photoInput.files || []).filter(file => file.type.startsWith('image/'));
        if (!selected.length) return;
        photoState.files = selected.slice(0, 300).sort((a,b) =>
            a.name.localeCompare(b.name, undefined, {numeric:true, sensitivity:'base'})
        );
        window.astroState.photoFiles = photoState.files;
        photoProcessBtn.disabled = false;
        fileInfoText.textContent = 'Загружено фотографий: ' + photoState.files.length +
            (selected.length > 300 ? ' (первые 300)' : '');
        document.getElementById('statusIcon').className = 'fa-solid fa-images overlay-icon';
        document.getElementById('statusIcon').style.display = '';
        document.getElementById('statusTitle').textContent = 'Фотографии готовы';
        document.getElementById('statusText').textContent =
            'Порядок наложения — по имени файла. Нажмите «Создать фотокомпозицию».';
        document.getElementById('statusOverlay').classList.remove('hidden');
    });

    photoProcessBtn.addEventListener('click', async () => {
        if (photoState.busy || !photoState.files.length) return;
        photoState.busy = true;
        photoProcessBtn.disabled = true;
        photoBtn.disabled = true;
        uploadBtnClick.disabled = true;
        const overlay = document.getElementById('statusOverlay');
        const title = document.getElementById('statusTitle');
        const message = document.getElementById('statusText');
        const spinner = document.getElementById('loaderSpinner');
        overlay.classList.remove('hidden');
        document.getElementById('statusIcon').style.display = 'none';
        spinner.className = 'google-spinner';
        spinner.style.display = 'block';
        title.textContent = 'Создание фотокомпозиции';
        const canvas = document.getElementById('glCanvas');
        const maxSide = 4096;
        let completed = 0, failed = 0;
        try {
            // Размер холста определяется первым доступным снимком, с защитой от чрезмерного разрешения.
            let firstBitmap = null;
            try {
                firstBitmap = await decodePhoto(photoState.files[0]);
            } catch (_) {}
            if (!firstBitmap) throw new Error('Не удалось прочитать первую фотографию.');
            const scale = Math.min(1, maxSide / Math.max(firstBitmap.width, firstBitmap.height));
            canvas.width = Math.max(1, Math.round(firstBitmap.width * scale));
            canvas.height = Math.max(1, Math.round(firstBitmap.height * scale));
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const slider = document.getElementById('startOpacity');
            const strength = Math.max(0.08, Math.min(1, Number(slider.value) / 100));
            for (let i = 0; i < photoState.files.length; i++) {
                let bitmap = i === 0 ? firstBitmap : null;
                try {
                    if (!bitmap) bitmap = await decodePhoto(photoState.files[i]);
                    const ratio = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
                    const w = bitmap.width * ratio, h = bitmap.height * ratio;
                    const x = (canvas.width - w) / 2, y = (canvas.height - h) / 2;
                    ctx.save();
                    ctx.globalCompositeOperation = 'lighten';
                    ctx.globalAlpha = i === 0 ? 1 : strength;
                    ctx.drawImage(bitmap, x, y, w, h);
                    ctx.restore();
                    completed++;
                    if (bitmap.close) bitmap.close();
                } catch (err) {
                    failed++;
                    if (bitmap && bitmap.close) bitmap.close();
                }
                title.textContent = 'Наложение фотографий: ' + (i + 1) + ' из ' + photoState.files.length;
                message.textContent = 'Обработано: ' + completed + ', пропущено: ' + failed;
                if (i % 5 === 0) await new Promise(resolve => requestAnimationFrame(resolve));
            }
            if (firstBitmap && firstBitmap.close) firstBitmap.close();
            window.astroState.rawCompositeBuffer = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const previewWidth = Math.min(canvas.width, 1024);
            const previewHeight = Math.max(1, Math.round(canvas.height * previewWidth / canvas.width));
            const preview = document.createElement('canvas');
            preview.width = previewWidth; preview.height = previewHeight;
            preview.getContext('2d').drawImage(canvas, 0, 0, previewWidth, previewHeight);
            window.astroState.previewBuffer = preview.getContext('2d').getImageData(0, 0, previewWidth, previewHeight);
            if (window.applyPostProcessing) window.applyPostProcessing();
            document.getElementById('secEffects').classList.remove('disabled-control');
            if (window.toggleFiltersState) window.toggleFiltersState(false);
            document.getElementById('downloadBtn').disabled = false;
            document.getElementById('resetBtn').disabled = false;
            document.getElementById('statusIcon').style.display = '';
            spinner.style.display = 'none';
            overlay.classList.add('hidden');
            message.textContent = 'Фотокомпозиция готова. Можно настроить цвет и экспортировать PNG.';
        } catch (error) {
            spinner.style.display = 'none';
            document.getElementById('statusIcon').style.display = '';
            document.getElementById('statusIcon').className = 'fa-solid fa-circle-exclamation overlay-icon';
            title.textContent = 'Не удалось создать композицию';
            message.textContent = error.message || 'Проверьте формат и доступность фотографий.';
        } finally {
            photoState.busy = false;
            photoProcessBtn.disabled = !photoState.files.length;
            photoBtn.disabled = false;
            uploadBtnClick.disabled = false;
        }
    });
})();

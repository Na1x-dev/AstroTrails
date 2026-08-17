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

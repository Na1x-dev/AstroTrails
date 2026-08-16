const effects = {
    brightness: document.getElementById('brightness'),
    contrast: document.getElementById('contrast'),
    gamma: document.getElementById('gamma'),
    channelR: document.getElementById('channelR'),
    channelG: document.getElementById('channelG'),
    channelB: document.getElementById('channelB')
};

// Привязываем события и обновляем проценты по корректным ID
Object.keys(effects).forEach(key => {
    if (window.enhanceSlider) {
        window.enhanceSlider(effects[key]);
    }

    effects[key].addEventListener('input', () => {
        let suffix = '%'; if(key === 'gamma') suffix = '';
        const displayVal = key === 'gamma' ? (effects[key].value / 100).toFixed(1) : effects[key].value;
        
        // КЛЮЧЕВОЙ ФИКС: Точное совпадение ID с HTML-структурой
        const valElement = document.getElementById(`${key}Val`);
        if (valElement) {
            valElement.textContent = displayVal + suffix;
        }
        
        // Мгновенно применяем стили
        window.applyPostProcessing(); 
    });
});

window.resetAllEffects = function() {
    Object.keys(effects).forEach(key => {
        effects[key].value = 100;
        let suffix = '%'; if(key === 'gamma') suffix = '';
        const displayVal = key === 'gamma' ? '1.0' : '100';
        
        const valElement = document.getElementById(`${key}Val`);
        if (valElement) {
            valElement.textContent = displayVal + suffix;
        }
    });

    // Принудительно вызываем обновление холста
    if (window.applyPostProcessing) {
        window.applyPostProcessing();
    }
};

window.toggleFiltersState = function(isDisabled) {
    Object.keys(effects).forEach(key => {
        effects[key].disabled = isDisabled;
        const steps = effects[key].parentNode.querySelectorAll('.btn-step');
        steps.forEach(b => { b.disabled = isDisabled; });
    });
};

window.applyPostProcessing = function() {
    if (!window.astroState || !window.astroState.previewBuffer) return;
    
    const canvas = document.getElementById('glCanvas');
    const ctx = canvas.getContext('2d');

    const imgData = new ImageData(
        new Uint8ClampedArray(window.astroState.previewBuffer.data),
        window.astroState.previewBuffer.width,
        window.astroState.previewBuffer.height
    );
    const data = imgData.data;

    const b = parseInt(effects.brightness.value) / 100;
    const c = parseInt(effects.contrast.value) - 100; 
    const g = parseInt(effects.gamma.value) / 100;
    const rM = parseInt(effects.channelR.value) / 100;
    const gM = parseInt(effects.channelG.value) / 100;
    const bM = parseInt(effects.channelB.value) / 100;

    const factor = (259 * (c + 255)) / (255 * (259 - c));

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i] * b * rM;
        let gChan = data[i+1] * b * gM;
        let bl = data[i+2] * b * bM;

        if (c !== 0) {
            r = factor * (r - 128) + 128;
            gChan = factor * (gChan - 128) + 128;
            bl = factor * (bl - 128) + 128;
        }

        if (g !== 1) {
            r = 255 * Math.pow(Math.clamp(r, 0, 255) / 255, 1 / g);
            gChan = 255 * Math.pow(Math.clamp(gChan, 0, 255) / 255, 1 / g);
            bl = 255 * Math.pow(Math.clamp(bl, 0, 255) / 255, 1 / g);
        }

        data[i] = r < 0 ? 0 : (r > 255 ? 255 : r);
        data[i+1] = gChan < 0 ? 0 : (gChan > 255 ? 255 : gChan);
        data[i+2] = bl < 0 ? 0 : (bl > 255 ? 255 : bl);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imgData.width;
    tempCanvas.height = imgData.height;
    tempCanvas.getContext('2d').putImageData(imgData, 0, 0);
    
    ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
};

Math.clamp = function(value, min, max) {
    return Math.min(max, Math.max(min, value));
};

document.getElementById('downloadBtn').addEventListener('click', (e) => {
    e.stopImmediatePropagation();
    if (!window.astroState || !window.astroState.rawCompositeBuffer) return;
    
    const originalBuffer = window.astroState.rawCompositeBuffer;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = originalBuffer.width;
    exportCanvas.height = originalBuffer.height;
    const exportCtx = exportCanvas.getContext('2d');
    
    const imgData = new ImageData(
        new Uint8ClampedArray(originalBuffer.data),
        originalBuffer.width,
        originalBuffer.height
    );
    const data = imgData.data;

    const b = parseInt(effects.brightness.value) / 100;
    const c = parseInt(effects.contrast.value) - 100; 
    const g = parseInt(effects.gamma.value) / 100;
    const rM = parseInt(effects.channelR.value) / 100;
    const gM = parseInt(effects.channelG.value) / 100;
    const bM = parseInt(effects.channelB.value) / 100;
    const factor = (259 * (c + 255)) / (255 * (259 - c));

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i] * b * rM;
        let gChan = data[i+1] * b * gM;
        let bl = data[i+2] * b * bM;

        if (c !== 0) {
            r = factor * (r - 128) + 128;
            gChan = factor * (gChan - 128) + 128;
            bl = factor * (bl - 128) + 128;
        }

        if (g !== 1) {
            r = 255 * Math.pow(Math.clamp(r, 0, 255) / 255, 1 / g);
            gChan = 255 * Math.pow(Math.clamp(gChan, 0, 255) / 255, 1 / g);
            bl = 255 * Math.pow(Math.clamp(bl, 0, 255) / 255, 1 / g);
        }

        data[i] = r < 0 ? 0 : (r > 255 ? 255 : r);
        data[i+1] = gChan < 0 ? 0 : (gChan > 255 ? 255 : gChan);
        data[i+2] = bl < 0 ? 0 : (bl > 255 ? 255 : bl);
    }

    exportCtx.putImageData(imgData, 0, 0);

    const link = document.createElement('a');
    link.download = `AstroTrails_HD_${Date.now()}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
});

window.toggleFiltersState(true);

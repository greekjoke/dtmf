/* DTMF player 
Requirements:
  - secure http context (https) or domain named localhost
  - require premission for using audio devices first
  - firefox: about:config / set media.setsinkid.enabled=true  
*/

const DTMF = function(opt) {

  opt = opt || {};

  const USE_DEFAULT_DEVICE = (opt.devUseDefault === undefined) ? false : opt.devUseDefault;
  const DEVICE_NAME_MASK = opt.devNameMask || 'cable';
  const TONE_DURATION =  opt.toneDuration === undefined ? 0.2 : opt.toneDuration;
  const TONE_DURATION2 =  opt.toneDuration === undefined ? 0.1 : opt.toneDuration2;
  const TONE_GAIN =  opt.toneGain === undefined ? 1.0 : opt.toneGain;
  const TONE_GAIN2 =  opt.toneGain === undefined ? 0.9 : opt.toneGain2;
  const SILENCE_PART_DURATION =  opt.silencePartDuration === undefined ? 0.1 : opt.silencePartDuration;
  const FADE_IN_DURATION =  opt.fadeInDuration === undefined ? 0.005 : opt.fadeInDuration;
  const FADE_OUT_DURATION = opt.fadeOutDuration === undefined ? 0.005 : opt.fadeOutDuration;
  const INSTANCE_ID = opt.id || 1;

  const Tones = {
    '1': [697, 1209],
    '2': [697, 1336],
    '3': [697, 1477],
    '4': [770, 1209],
    '5': [770, 1336],
    '6': [770, 1477],
    '7': [852, 1209],
    '8': [852, 1336],
    '9': [852, 1477],
    '*': [941, 1209],
    '0': [941, 1336],    
    '#': [941, 1477],
  };

  console.log('USE_DEFAULT_DEVICE', USE_DEFAULT_DEVICE);

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const audioElement = document.createElement("audio");

  if (audioElement.setSinkId === undefined) {
    console.error('setSinkId not supported');
    return null;
  }
  
  let audioCtx = null;
  let onInitResolve = null;
  let onInitReject = null;
  let outputDevice = null;
    
  function onEnumDevices(list) {
    console.log('devices', list);

    const mask = DEVICE_NAME_MASK;
    const output = list.filter(({kind}) => kind === 'audiooutput');
    const device = output.filter((d) => d.label.toLowerCase().indexOf(mask) != -1).pop();    
        
    if (device === undefined && !USE_DEFAULT_DEVICE)      
      throw `output device not found for mask: ${mask}`;
    
    outputDevice = device;      
    console.log('select device', outputDevice);

    buildTones(device ? device.deviceId : undefined);
  }

  function generateSilence(sampleRate, duration) {        
    const nSampels = sampleRate * duration;
    const floats = new Float32Array(nSampels);    
    floats.fill(0);
    return floats;
  }

  function generateTone(sampleRate, duration, frequency, gain) {    
    const nSecs = duration || 5;
    const nSampels = sampleRate * nSecs;
    const floats = new Float32Array(nSampels);        
    const fadeIn = FADE_IN_DURATION;
    const fadeOut = FADE_OUT_DURATION;
    const eps = 0.000001;

    gain = gain || TONE_GAIN;

    let freqA, freqB;

    if (Array.isArray(frequency)) {
      freqA = frequency[0];
      freqB = frequency[1];
    } else {
      freqA = frequency || 440;
      freqB = 0;
    }

    for (let v, i = 0; i < nSampels; i++)
    {
        if (freqB > 0) {
          v = (Math.sin(i * freqA * 2 * Math.PI / sampleRate) +
            Math.sin(i * freqB * 2 * Math.PI / sampleRate)) / 2;
        } else {
          v = Math.sin(i * freqA * 2 * Math.PI / sampleRate);
        }

        const t = 1.0 * i / sampleRate;
        const uFadeIn = t - fadeIn;
        const vFadeIn = (uFadeIn > 0 || fadeIn < eps) ? 1 : (uFadeIn + fadeIn) / fadeIn;
        const uFadeOut = duration - t - fadeOut;
        const vFadeOut = (uFadeOut > 0 || fadeOut < eps) ? 1 : (uFadeOut + fadeOut) / fadeOut;
        
        floats[i] = v * gain * vFadeIn * vFadeOut;
    }

    return floats;
  }

  function mergeBuffers(recBuffers) {    
    const recLength = recBuffers.reduce((r,x) => (r + x.length), 0);
    const result = new Float32Array(recLength);
    let ofs = 0;

    for (let i = 0; i < recBuffers.length; i++){
        result.set(recBuffers[i], ofs);
        ofs += recBuffers[i].length;
    }
    
    return result;
  }

  function mixBuffers(recBuffers) {
    if (recBuffers.length < 1) 
      return null;
    
    const first = recBuffers[0];
    const numBuffers = recBuffers.length;    
    const numSamples = first.length;
    const result = new Float32Array(numSamples);
    
    result.fill(0);
    
    for (let i = 0; i < numBuffers; i++) {
      const buf = recBuffers[i];
      for (let j = 0; j < numSamples; j++) {
        result[j] = result[j] + buf[j];
      }
    }
    
    for (let j = 0; j < numSamples; j++) {
      result[j] = result[j] / numBuffers;
    }

    return result;
  }

  function buildTones(deviceId) {
    const pList = [];

    for(let k in Tones) {
      const freq  = Tones[k];
      const elemData = createAudioElement(freq);
      
      Tones[k] = {frequency:freq, element:elemData.elem, deviceId:deviceId};

      if (deviceId !== undefined && !USE_DEFAULT_DEVICE) {           
        pList.push({elemData:elemData, key:k, dev:deviceId});        
      } else {
        elemData.setup();
      }
    }

    if (pList.length < 1) {
      onInitResolve();
      return;
    }

    function exec(p) {
      if (!p) {
        onInitResolve();
        return;
      }      
      p.elemData.elem.setSinkId(p.dev)
        .then(() => {          
          p.elemData.setup();
          exec(pList.pop());          
        })
        .catch((err) => onInitReject(`setSinkId failed (${p.key}): ${err}`))
        ;
    }

    exec(pList.pop());
  }

  function createAudioElement(freq) {

    audioCtx = audioCtx || new AudioContext();

    const elem = document.createElement("audio");
    const sampleRate = audioCtx.sampleRate;
    const tone2ofs = (TONE_DURATION - TONE_DURATION2) / 2;

    const tone1 = generateTone(sampleRate, TONE_DURATION, freq[0], TONE_GAIN2);

    const tone2 = mergeBuffers([
      generateSilence(sampleRate, tone2ofs),
      generateTone(sampleRate, TONE_DURATION2, freq[1], TONE_GAIN),
      generateSilence(sampleRate, tone2ofs),
    ]);
    const mix = mixBuffers([tone1, tone2]);
    
    const floats = mergeBuffers([
      generateSilence(sampleRate, SILENCE_PART_DURATION),
      mix /*generateTone(sampleRate, TONE_DURATION, freq)*/,
      generateSilence(sampleRate, SILENCE_PART_DURATION)
    ]);  
    
    const blob = WAV(sampleRate, floats);
    const url = window.URL.createObjectURL(blob);
    //const url = 'media/tone1.wav'; // HACK
        
    return {
      elem: elem,       
      setup: function() {        
        elem.src = url;
        document.body.appendChild(elem);
      }
    };
  }

  return {
    init: function() {    
      if (onInitResolve) return; // already initialized
      return new Promise((resolve, reject) => {
        console.log('init...');
        onInitResolve = resolve;
        onInitReject = reject;
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then((strm) => navigator.mediaDevices.enumerateDevices())        
          .then((res) => onEnumDevices(res))
          .catch((err) => reject('init failed:' + err))
          ;
      });      
    },
    get device() {
      return outputDevice;
    },
    get id() {
      return INSTANCE_ID;
    },
    play: function(toneKey) { 
      if (!(toneKey in Tones)) {
        console.error('invalid toneKey', toneKey);
        return false;
      }      

      const elem = Tones[toneKey].element;
      if (!elem) {
        console.error('toneKey element not found', toneKey);
        return false;  
      }
      
      elem.play();      
      return true;
    }
  }  
};

const WAV = function(sampleRate, bufferL, bufferR) {
  
  function interleave(inputL, inputR) {
    const length = inputL.length + inputR.length;
    const result = new Float32Array(length);
    let index = 0, inputIndex = 0;
    while (index < length){
        result[index++] = inputL[inputIndex];
        result[index++] = inputR[inputIndex];
        inputIndex++;
    }
    return result;
  }

  function floatTo16BitPCM(output, offset, input) {
      for (let i = 0; i < input.length; i++, offset+=2) {
          let s = Math.max(-1, Math.min(1, input[i]));
          output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
  }

  function writeString(view, offset, string) {
      for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
      }
  }

  function encodeWAV(samples, mono) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    /* RIFF identifier */
    writeString(view, 0, 'RIFF');
    /* file length */
    view.setUint32(4, 32 + samples.length * 2, true);
    /* RIFF type */
    writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw) */
    view.setUint16(20, 1, true);
    /* channel count */
    view.setUint16(22, mono?1:2, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, sampleRate * 4, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, 4, true);
    /* bits per sample */
    view.setUint16(34, 16, true);
    /* data chunk identifier */
    writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, samples.length * 2, true);

    floatTo16BitPCM(view, 44, samples);

    return view;
  }

  let dataview = null;

  if (bufferR === undefined) {
     dataview = encodeWAV(bufferL, true);
  } else {
    dataview = encodeWAV(interleave(bufferL, bufferR), false);
  }
  
  const audioBlob = new Blob([dataview], { type: 'audio/wav' });

  return audioBlob;
};
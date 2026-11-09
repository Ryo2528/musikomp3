const prepareForm = document.querySelector('#prepare-form');
const exportForm = document.querySelector('#export-form');
const urlField = document.querySelector('#video-url');
const prepareButton = document.querySelector('#prepare');
const downloadButton = document.querySelector('#download');
const prepareStatus = document.querySelector('#prepare-status');
const exportStatus = document.querySelector('#export-status');
const tags = document.querySelector('#tags');
const title = document.querySelector('#title');
const artist = document.querySelector('#artist');
const album = document.querySelector('#album');
const duration = document.querySelector('#duration');
const artwork = document.querySelector('#artwork');
const coverFile = document.querySelector('#cover-file');
const includeCover = document.querySelector('#include-cover');
let track;
let coverPreview;

function status(element, message, error = false) {
  element.classList.toggle('error', error);
  element.textContent = message;
}

async function post(payload) {
  const response = await fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'The converter could not complete the request.');
  }
  return response;
}

function refreshArtwork() {
  if (coverPreview) URL.revokeObjectURL(coverPreview);
  const file = coverFile.files[0];
  coverPreview = file ? URL.createObjectURL(file) : null;
  const cover = includeCover.checked && (coverPreview || track?.cover);
  if (cover) artwork.src = cover;
  else artwork.removeAttribute('src');
  artwork.hidden = !cover;
}

function showTrack() {
  title.value = track?.title || '';
  artist.value = track?.artist || '';
  album.value = track?.album || '';
  const seconds = Math.floor(track?.duration || 0);
  duration.textContent = seconds ? `MP3 · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'MP3';
  coverFile.value = '';
  includeCover.checked = Boolean(track?.cover);
  refreshArtwork();
  tags.disabled = !track;
}

prepareForm.addEventListener('submit', async event => {
  event.preventDefault();
  prepareButton.disabled = true;
  urlField.readOnly = true;
  track = null;
  showTrack();
  status(exportStatus, 'Track details will appear once the video is found.');
  status(prepareStatus, 'Looking up the video and its track details…');
  try {
    const url = urlField.value.trim();
    const response = await post({ action: 'inspect', url });
    track = { ...await response.json(), url };
    showTrack();
    status(prepareStatus, 'Track ready. Review the details before downloading.');
    status(exportStatus, 'Your edits will be saved inside the MP3.');
    title.focus();
  } catch (error) {
    status(prepareStatus, error.message, true);
    status(exportStatus, 'Prepare a video to fill in its track details.');
  } finally {
    prepareButton.disabled = false;
    urlField.readOnly = false;
  }
});

coverFile.addEventListener('change', () => {
  const file = coverFile.files[0];
  if (file && (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 2 * 1024 * 1024)) {
    coverFile.value = '';
    status(exportStatus, 'Choose a JPG or PNG image up to 2 MB.', true);
  } else if (file) {
    includeCover.checked = true;
    status(exportStatus, 'Custom cover selected.');
  }
  refreshArtwork();
});
includeCover.addEventListener('change', refreshArtwork);

function encodeCover(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result.split(',')[1]));
    reader.addEventListener('error', () => reject(new Error('Could not read the cover image.')));
    reader.readAsDataURL(file);
  });
}

exportForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!track || downloadButton.disabled) return;
  downloadButton.disabled = true;
  prepareButton.disabled = true;
  status(exportStatus, 'Converting audio and writing your track details. This can take a minute…');
  try {
    const file = includeCover.checked && coverFile.files[0];
    const data = {
      action: 'convert',
      url: track.url,
      title: title.value,
      artist: artist.value,
      album: album.value,
      includeCover: includeCover.checked,
      cover: file ? await encodeCover(file) : null
    };
    const response = await post(data);
    const filename = response.headers.get('Content-Disposition')?.split("filename*=UTF-8''")[1];
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename ? decodeURIComponent(filename) : 'track.mp3';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    status(exportStatus, 'MP3 downloaded.');
  } catch (error) {
    status(exportStatus, error.message, true);
  } finally {
    downloadButton.disabled = false;
    prepareButton.disabled = false;
  }
});

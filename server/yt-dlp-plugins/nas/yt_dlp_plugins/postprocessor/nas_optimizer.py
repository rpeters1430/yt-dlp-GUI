"""Conservative NAS optimizations; uses the installed yt-dlp's own processing code."""
import contextlib
import errno
import shutil
import tempfile
import itertools
import json
import os
import socket
import threading
import time

from yt_dlp.postprocessor.common import PostProcessor
from yt_dlp.utils import PostProcessingError
from yt_dlp.postprocessor.embedthumbnail import EmbedThumbnailPP
from yt_dlp.postprocessor.ffmpeg import FFmpegMergerPP, FFmpegMetadataPP, FFmpegPostProcessor
from yt_dlp.postprocessor.movefilesafterdownload import MoveFilesAfterDownloadPP

ORIGINAL_FFMPEG = FFmpegPostProcessor.real_run_ffmpeg
ORIGINAL_MERGER = FFmpegMergerPP.run
ORIGINAL_METADATA = FFmpegMetadataPP.run
ORIGINAL_THUMBNAIL = EmbedThumbnailPP.run
ORIGINAL_MOVE = MoveFilesAfterDownloadPP.run
LOCAL = threading.local()
INSTALLED = False


def emit(event, stage, **fields):
    print('YTDLP_NAS ' + json.dumps({'event': event, 'stage': stage, **fields}), flush=True)


@contextlib.contextmanager
def processing_slot(stage):
    if getattr(LOCAL, 'depth', 0):
        yield
        return
    emit('waiting', stage)
    connection = None
    try:
        endpoint = os.environ.get('YTDLP_GUI_PROCESSING_GATE')
        if endpoint:
            port, token = endpoint.split(':', 1)
            connection = socket.create_connection(('127.0.0.1', int(port)), timeout=10)
            connection.settimeout(None)
            connection.sendall((token + '\n').encode())
            response = b''
            while not response.endswith(b'\n') and len(response) < 16:
                chunk = connection.recv(16 - len(response))
                if not chunk:
                    break
                response += chunk
            if response != b'go\n':
                raise RuntimeError('Processing coordinator disconnected')
        LOCAL.depth = 1
        start = time.monotonic()
        emit('started', stage)
        try:
            yield
        finally:
            emit('finished', stage, seconds=round(time.monotonic() - start, 3))
    finally:
        LOCAL.depth = 0
        if connection:
            connection.close()


def can_fuse(ydl, info):
    state = getattr(ydl, '_nas_optimizer', {})
    if not state.get('fuse') or info.get('ext') != 'mp4' or info.get('chapters'):
        return False
    if ydl.params.get('postprocessor_args'):
        return False
    processors = ydl._pps.get('post_process', [])
    if any(pp.pp_key() in ('ModifyChapters', 'EmbedSubtitle', 'SplitChapters', 'VideoConvertor', 'VideoRemuxer') for pp in processors):
        return False
    metadata = [pp for pp in processors if isinstance(pp, FFmpegMetadataPP)]
    return len(metadata) == 1 and metadata[0]._add_metadata


def run_ffmpeg(self, inputs, outputs, **kwargs):
    if not hasattr(self._downloader, '_nas_optimizer'):
        return ORIGINAL_FFMPEG(self, inputs, outputs, **kwargs)
    info = getattr(LOCAL, 'merge_info', None)
    if info is not None and can_fuse(self._downloader, info):
        metadata = next(pp for pp in self._downloader._pps['post_process'] if isinstance(pp, FFmpegMetadataPP))
        tags = list(itertools.chain.from_iterable(metadata._get_metadata_opts(info)))
        # Only claim the step after FFmpeg succeeds. A failed merge must be retryable.
        outputs = [(out, [*opts, *tags]) for out, opts in outputs]
    else:
        info = None
    # yt-dlp adds +faststart after output opts. Override it at its configuration
    # boundary only for known intermediate MP4 stages followed by a metadata rewrite.
    metadata_later = any(isinstance(pp, FFmpegMetadataPP) and pp._add_metadata
                         for pp in self._downloader._pps.get('post_process', []))
    skip_faststart = info is None and metadata_later and self.pp_key() in ('Merger', 'EmbedSubtitle', 'ModifyChapters') and all(
        output and str(output).lower().endswith('.mp4') for output, _ in outputs)
    original_config = self._configuration_args
    had_override = '_configuration_args' in self.__dict__
    def configuration(executable, keys=None, *args, **kw):
        user = original_config(executable, keys, *args, **kw)
        if skip_faststart and executable == 'ffmpeg' and any(key.startswith('_o') for key in (keys or [])):
            return ['-movflags', '-faststart', *user]
        return user
    self._configuration_args = configuration
    try:
        with processing_slot(self.pp_key()):
            result = ORIGINAL_FFMPEG(self, inputs, outputs, **kwargs)
    finally:
        if had_override:
            self._configuration_args = original_config
        else:
            del self._configuration_args
    if info is not None:
        info['__nas_metadata_embedded'] = True
    return result


def run_merger(self, info):
    LOCAL.merge_info = info
    try:
        return ORIGINAL_MERGER(self, info)
    finally:
        LOCAL.merge_info = None


def run_metadata(self, info):
    if info.pop('__nas_metadata_embedded', False):
        emit('combined', 'Metadata')
        return [], info
    return ORIGINAL_METADATA(self, info)


def run_thumbnail(self, info):
    if not hasattr(self._downloader, '_nas_optimizer'):
        return ORIGINAL_THUMBNAIL(self, info)
    with processing_slot('EmbedThumbnail'):
        return ORIGINAL_THUMBNAIL(self, info)


def atomic_move(source, destination):
    """Publish a cross-volume copy only when complete, retaining the source on failure."""
    try:
        os.replace(source, destination)
        return
    except OSError as error:
        if error.errno != errno.EXDEV:
            raise
    parent = os.path.dirname(os.path.abspath(destination))
    fd, temporary = tempfile.mkstemp(prefix='.nas-transfer-', suffix='.part', dir=parent)
    os.close(fd)
    try:
        shutil.copy2(source, temporary)
        with open(temporary, 'rb') as copied:
            os.fsync(copied.fileno())
        os.replace(temporary, destination)
        os.unlink(source)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def run_move(self, info):
    if not hasattr(self._downloader, '_nas_optimizer'):
        return ORIGINAL_MOVE(self, info)
    with processing_slot('MoveFiles'):
        if not self._downloader.params.get('paths', {}).get('temp'):
            return ORIGINAL_MOVE(self, info)
        # The standard mover removes an existing destination before copying. With an SSD
        # workspace, publish atomically so a failed/ENOSPC copy cannot destroy that file.
        directory, name = os.path.split(info['filepath'])
        finaldir = info.get('__finaldir', directory)
        finalpath = os.path.join(finaldir, name)
        if self._downloaded:
            info['__files_to_move'][info['filepath']] = finalpath
        for source, destination in info['__files_to_move'].items():
            destination = destination or os.path.join(finaldir, os.path.basename(source))
            if os.path.abspath(source) == os.path.abspath(destination):
                continue
            if not os.path.exists(source):
                self.report_warning(f'File "{source}" cannot be found')
                continue
            if os.path.exists(destination) and not self.get_param('overwrites', True):
                self.report_warning(f'Cannot move "{source}": "{destination}" already exists')
                continue
            try:
                os.makedirs(os.path.dirname(os.path.abspath(destination)), exist_ok=True)
                atomic_move(source, destination)
            except OSError as error:
                raise PostProcessingError(f'Unable to save final file: {error}') from error
        info['filepath'] = finalpath
        return [], info


class NasOptimizerPP(PostProcessor):
    def __init__(self, downloader=None, fuse='false'):
        super().__init__(downloader)
        self.fuse = str(fuse).lower() in ('true', '1', 'yes')

    def run(self, info):
        global INSTALLED
        self._downloader._nas_optimizer = {'fuse': self.fuse}
        if not INSTALLED:
            FFmpegPostProcessor.real_run_ffmpeg = run_ffmpeg
            FFmpegMergerPP.run = run_merger
            FFmpegMetadataPP.run = run_metadata
            EmbedThumbnailPP.run = run_thumbnail
            MoveFilesAfterDownloadPP.run = run_move
            INSTALLED = True
        return [], info

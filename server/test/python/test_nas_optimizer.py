import importlib.util
import io
import errno
import json
import pathlib
import subprocess
import tempfile
import struct
import sys
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

PLUGIN = pathlib.Path(__file__).parents[2] / 'yt-dlp-plugins/nas/yt_dlp_plugins/postprocessor/nas_optimizer.py'
spec = importlib.util.spec_from_file_location('nas_optimizer', PLUGIN)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

from yt_dlp import YoutubeDL
from yt_dlp.postprocessor.ffmpeg import FFmpegMergerPP, FFmpegMetadataPP


class OptimizerTests(unittest.TestCase):
    def test_merger_fuses_metadata_and_skips_only_the_already_embedded_step(self):
        ydl = YoutubeDL({'quiet': True})
        metadata = FFmpegMetadataPP(ydl, add_metadata=True, add_chapters=False, add_infojson=False)
        ydl.add_post_processor(metadata)
        module.NasOptimizerPP(ydl, fuse='true').run({})
        info = {'filepath': '/tmp/video.mp4', 'ext': 'mp4', 'title': 'Preserved title',
                'requested_formats': [{'acodec': 'none', 'vcodec': 'h264'}, {'acodec': 'aac', 'vcodec': 'none', 'protocol': 'https'}],
                '__files_to_merge': ['/tmp/v.mp4', '/tmp/a.m4a']}
        merger = FFmpegMergerPP(ydl)
        calls = []
        with patch.object(module, 'ORIGINAL_FFMPEG', side_effect=lambda self, ins, outs, **kw: calls.append((ins, outs))), patch('os.rename'):
            merger.run(info)
        self.assertIn('title=Preserved title', calls[0][1][0][1])
        with patch.object(metadata, 'run_ffmpeg_multiple_files', side_effect=AssertionError('duplicate rewrite')):
            metadata.run(info)

    def test_no_fusion_with_chapters_or_custom_metadata_arguments(self):
        for chapters, ppa in [([{'start_time': 0, 'end_time': 5, 'title': 'Chapter'}], {}), ([], {'metadata': ['-metadata', 'title=Custom']})]:
            ydl = YoutubeDL({'quiet': True, 'postprocessor_args': ppa})
            metadata = FFmpegMetadataPP(ydl, add_metadata=True, add_chapters=True, add_infojson=False)
            ydl.add_post_processor(metadata)
            module.NasOptimizerPP(ydl, fuse='true').run({})
            info = {'ext': 'mp4', 'chapters': chapters}
            self.assertFalse(module.can_fuse(ydl, info))

    def test_real_ffmpeg_fusion_preserves_tags_codec_and_final_faststart(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = pathlib.Path(folder)
            video, audio, output = [str(folder / name) for name in ('video.mp4', 'audio.m4a', 'final.mp4')]
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:d=1', '-c:v', 'mpeg4', video], check=True)
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:a', 'aac', audio], check=True)
            ydl = YoutubeDL({'quiet': True})
            metadata = FFmpegMetadataPP(ydl, add_metadata=True, add_chapters=False, add_infojson=False)
            ydl.add_post_processor(metadata)
            module.NasOptimizerPP(ydl, fuse='true').run({})
            info = {'filepath': output, 'ext': 'mp4', 'title': 'Preserved title',
                    'requested_formats': [{'acodec': 'none', 'vcodec': 'mpeg4'}, {'acodec': 'aac', 'vcodec': 'none', 'protocol': 'https'}],
                    '__files_to_merge': [video, audio]}
            original = module.ORIGINAL_FFMPEG
            with patch.object(module, 'ORIGINAL_FFMPEG', autospec=True, side_effect=original) as calls:
                FFmpegMergerPP(ydl).run(info)
                metadata.run(info)
                self.assertEqual(calls.call_count, 1, 'merge and metadata must use one FFmpeg pass')
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', output]))
            self.assertEqual(probe['format']['tags']['title'], 'Preserved title')
            self.assertEqual([stream['codec_name'] for stream in probe['streams']], ['mpeg4', 'aac'])
            data = pathlib.Path(output).read_bytes()
            atoms, offset = [], 0
            while offset + 8 <= len(data):
                size, atom = struct.unpack('>I4s', data[offset:offset + 8])
                atoms.append(atom)
                if size < 8:
                    break
                offset += size
            self.assertLess(atoms.index(b'moov'), atoms.index(b'mdat'), 'final MP4 retains fast-start')


    def test_complex_metadata_retains_chapters_and_faststart_only_on_final_rewrite(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = pathlib.Path(folder)
            source, output = str(folder / 'video.mp4'), str(folder / 'final.mp4')
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:d=1', '-c:v', 'mpeg4', source], check=True)
            ydl = YoutubeDL({'quiet': True})
            metadata = FFmpegMetadataPP(ydl, add_metadata=True, add_chapters=True, add_infojson=False)
            ydl.add_post_processor(metadata)
            module.NasOptimizerPP(ydl, fuse='true').run({})
            info = {'filepath': output, 'ext': 'mp4', 'title': 'Chapter video',
                    'chapters': [{'start_time': 0, 'end_time': 1, 'title': 'Preserved chapter'}],
                    'requested_formats': [{'acodec': 'none', 'vcodec': 'mpeg4'}], '__files_to_merge': [source]}
            FFmpegMergerPP(ydl).run(info)
            intermediate = pathlib.Path(output).read_bytes()
            self.assertGreater(intermediate.index(b'moov'), intermediate.index(b'mdat'), 'intermediate faststart is omitted')
            metadata.run(info)
            final = pathlib.Path(output).read_bytes()
            self.assertLess(final.index(b'moov'), final.index(b'mdat'), 'final faststart is preserved')
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_chapters', '-of', 'json', output]))
            self.assertEqual(probe['chapters'][0]['tags']['title'], 'Preserved chapter')


    def test_failed_cross_filesystem_publish_preserves_source_and_existing_destination(self):
        with tempfile.TemporaryDirectory() as folder:
            source, destination = pathlib.Path(folder) / 'source.mp4', pathlib.Path(folder) / 'final.mp4'
            source.write_bytes(b'new completed video')
            destination.write_bytes(b'existing completed video')
            with patch.object(module.os, 'replace', side_effect=OSError(errno.EXDEV, 'cross-device')), patch.object(module.shutil, 'copy2', side_effect=OSError(errno.ENOSPC, 'No space left on device')):
                with self.assertRaises(OSError):
                    module.atomic_move(source, destination)
            self.assertEqual(source.read_bytes(), b'new completed video')
            self.assertEqual(destination.read_bytes(), b'existing completed video')
            self.assertEqual(sorted(path.name for path in pathlib.Path(folder).iterdir()), ['final.mp4', 'source.mp4'])


    def test_real_download_uses_the_shared_gate_and_preserves_the_library_destination(self):
        binary = pathlib.Path(sys.executable).with_name('yt-dlp.exe' if module.os.name == 'nt' else 'yt-dlp')
        script = pathlib.Path(__file__).parents[3] / 'scripts/ci/nas-download-integration.cjs'
        result = subprocess.run(['node', str(script)], env={**module.os.environ, 'YTDLP_TEST_BIN': str(binary)}, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('NAS download integration passed', result.stdout)


    def test_gate_emits_real_boundaries_and_releases_after_failure(self):
        output = io.StringIO()
        with redirect_stdout(output):
            with self.assertRaisesRegex(ValueError, 'bad media'):
                with module.processing_slot('Metadata'):
                    raise ValueError('bad media')
        events = [json.loads(line.split(' ', 1)[1]) for line in output.getvalue().splitlines()]
        self.assertEqual([event['event'] for event in events], ['waiting', 'started', 'finished'])
        self.assertGreaterEqual(events[-1]['seconds'], 0)


if __name__ == '__main__':
    unittest.main()

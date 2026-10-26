"""Mutagen tag writer. JSON on stdin/stdout; invoked only with server-owned file paths.

Write to a sibling copy, verify requested tags after reopening, then atomically replace.
Never re-encode or modify the original on failure. No network access in this helper.
"""
import base64
import hashlib
import json
import os
import shutil
import sys
import tempfile

import mutagen
from mutagen import id3
from mutagen.flac import FLAC, Picture
from mutagen.mp4 import MP4, MP4Cover
from mutagen.wave import WAVE
from mutagen.mp3 import MP3

# Logical field -> ID3 text frame / MP4 atom / Vorbis comment.
FIELDS = {
    'title': ('TIT2', '\xa9nam', 'title'),
    'artist': ('TPE1', '\xa9ART', 'artist'),
    'albumArtist': ('TPE2', 'aART', 'albumartist'),
    'album': ('TALB', '\xa9alb', 'album'),
    'date': ('TDRC', '\xa9day', 'date'),
    'originalDate': ('TDOR', '----:com.apple.iTunes:ORIGINALDATE', 'originaldate'),
    'genre': ('TCON', '\xa9gen', 'genre'),
    'artistSort': ('TSOP', 'soar', 'artistsort'),
    'albumArtistSort': ('TSO2', 'soaa', 'albumartistsort'),
    'composer': ('TCOM', '\xa9wrt', 'composer'),
    'copyright': ('TCOP', 'cprt', 'copyright'),
    'label': ('TPUB', '----:com.apple.iTunes:LABEL', 'label'),
    'isrc': ('TSRC', '----:com.apple.iTunes:ISRC', 'isrc'),
    'musicbrainzReleaseId': ('MusicBrainz Album Id', '----:com.apple.iTunes:MusicBrainz Album Id', 'musicbrainz_albumid'),
    'musicbrainzReleaseGroupId': ('MusicBrainz Release Group Id', '----:com.apple.iTunes:MusicBrainz Release Group Id', 'musicbrainz_releasegroupid'),
    'musicbrainzRecordingId': ('MusicBrainz Track Id', '----:com.apple.iTunes:MusicBrainz Track Id', 'musicbrainz_trackid'),
    'musicbrainzReleaseTrackId': ('MusicBrainz Release Track Id', '----:com.apple.iTunes:MusicBrainz Release Track Id', 'musicbrainz_releasetrackid'),
    'musicbrainzArtistIds': ('MusicBrainz Artist Id', '----:com.apple.iTunes:MusicBrainz Artist Id', 'musicbrainz_artistid'),
    'musicbrainzAlbumArtistIds': ('MusicBrainz Album Artist Id', '----:com.apple.iTunes:MusicBrainz Album Artist Id', 'musicbrainz_albumartistid'),
    'releaseCountry': ('MusicBrainz Album Release Country', '----:com.apple.iTunes:MusicBrainz Album Release Country', 'releasecountry'),
    'releaseStatus': ('MusicBrainz Album Status', '----:com.apple.iTunes:MusicBrainz Album Status', 'releasestatus'),
    'releaseType': ('MusicBrainz Album Type', '----:com.apple.iTunes:MusicBrainz Album Type', 'releasetype'),
    'artists': ('ARTISTS', '----:com.apple.iTunes:ARTISTS', 'artists'),
    'albumArtists': ('ALBUMARTISTS', '----:com.apple.iTunes:ALBUMARTISTS', 'albumartists'),
}
ARRAYS = {'musicbrainzArtistIds', 'musicbrainzAlbumArtistIds', 'artists', 'albumArtists'}


def text_values(value):
    items = value if isinstance(value, list) else [value]
    return [str(x).strip() for x in items if x is not None and str(x).strip()]


def expected_tags(meta):
    meta = dict(meta)
    meta['albumArtist'] = meta.get('albumArtist') or meta.get('artist')
    meta['date'] = meta.get('date') or meta.get('year')
    result = {}
    for field in FIELDS:
        values = text_values(meta.get(field))
        if values:
            result[field] = values if field in ARRAYS else values[0]
    for field, total in [('trackNumber', 'totalTracks'), ('discNumber', 'totalDiscs')]:
        if meta.get(field):
            result[field] = str(int(meta[field]))
            if meta.get(total):
                result[total] = str(int(meta[total]))
    return result


def is_id3(audio):
    return isinstance(audio, (MP3, WAVE))


def write_tags(audio, values):
    tags = audio.tags
    for field, value in values.items():
        if field not in FIELDS:
            continue
        frame, atom, comment = FIELDS[field]
        vals = text_values(value)
        if is_id3(audio):
            if frame.startswith('T') and len(frame) == 4:
                tags.add(getattr(id3, frame)(encoding=3, text=vals))
            else:
                tags.delall('TXXX:' + frame)
                tags.add(id3.TXXX(encoding=3, desc=frame, text=vals))
        elif isinstance(audio, MP4):
            tags[atom] = [v.encode('utf-8') for v in vals] if atom.startswith('----:') else vals
        else:
            tags[comment] = vals
    if is_id3(audio) and values.get('musicbrainzRecordingId'):
        tags.add(id3.UFID(owner='http://musicbrainz.org', data=values['musicbrainzRecordingId'].encode('ascii')))
    for field, total, frame, atom, comment in [('trackNumber', 'totalTracks', 'TRCK', 'trkn', 'tracknumber'), ('discNumber', 'totalDiscs', 'TPOS', 'disk', 'discnumber')]:
        if field not in values:
            continue
        number = values[field]
        count = values.get(total)
        if is_id3(audio):
            tags.add(getattr(id3, frame)(encoding=3, text=[number + ('/' + count if count else '')]))
        elif isinstance(audio, MP4):
            tags[atom] = [(int(number), int(count or 0))]
        else:
            tags[comment] = [number]
            if count:
                tags['tracktotal' if field == 'trackNumber' else 'disctotal'] = [count]


def read_tags(audio):
    result = {}
    tags = audio.tags or {}
    for field, (frame, atom, comment) in FIELDS.items():
        if is_id3(audio):
            key = frame if frame.startswith('T') and len(frame) == 4 else 'TXXX:' + frame
            obj = tags.get(key)
            vals = text_values(obj.text) if obj else []
        elif isinstance(audio, MP4):
            vals = [v.decode('utf-8') if isinstance(v, bytes) else str(v) for v in tags.get(atom, [])]
        else:
            vals = tags.get(comment, [])
        if vals:
            result[field] = vals if field in ARRAYS else str(vals[0])
    if is_id3(audio):
        recording = tags.get('UFID:http://musicbrainz.org')
        if recording is not None:
            result['musicbrainzRecordingId'] = recording.data.decode('utf-8', errors='replace')
    for field, total, frame, atom, comment in [('trackNumber', 'totalTracks', 'TRCK', 'trkn', 'tracknumber'), ('discNumber', 'totalDiscs', 'TPOS', 'disk', 'discnumber')]:
        if is_id3(audio):
            vals = str(tags.get(frame, '')).split('/')
        elif isinstance(audio, MP4):
            vals = [str(v) for v in tags.get(atom, [(0, 0)])[0]]
        else:
            vals = str(tags.get(comment, [''])[0]).split('/')
            count = tags.get('tracktotal' if field == 'trackNumber' else 'disctotal')
            if count:
                vals = [vals[0], count[0]]
        if vals[0] and vals[0] != '0':
            result[field] = vals[0]
        if len(vals) > 1 and vals[1] and vals[1] != '0':
            result[total] = vals[1]
    return result


def write_artwork(audio, art):
    data = base64.b64decode(art['data'], validate=True)
    png = data.startswith(b'\x89PNG\r\n\x1a\n')
    if not png and not data.startswith(b'\xff\xd8\xff'):
        raise ValueError('Artwork must be JPEG or PNG')
    mime = 'image/png' if png else 'image/jpeg'
    if is_id3(audio):
        audio.tags.delall('APIC')
        audio.tags.add(id3.APIC(encoding=3, mime=mime, type=3, desc='Cover (front)', data=data))
    elif isinstance(audio, MP4):
        audio.tags['covr'] = [MP4Cover(data, imageformat=MP4Cover.FORMAT_PNG if png else MP4Cover.FORMAT_JPEG)]
    else:
        pic = Picture()
        pic.type, pic.mime, pic.desc, pic.data = 3, mime, 'Cover (front)', data
        if isinstance(audio, FLAC):
            audio.clear_pictures()
            audio.add_picture(pic)
        else:
            audio.tags['metadata_block_picture'] = [base64.b64encode(pic.write()).decode('ascii')]


def has_artwork(audio):
    if audio.tags is None:
        return False
    if is_id3(audio):
        return bool(audio.tags.getall('APIC'))
    if isinstance(audio, MP4):
        return bool(audio.tags.get('covr'))
    if isinstance(audio, FLAC):
        return bool(audio.pictures)
    return bool(audio.tags.get('metadata_block_picture'))


def digest_file(filename):
    result = hashlib.sha256()
    with open(filename, 'rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def clear_fields(audio, fields):
    for field in fields:
        numeric = {'trackNumber': ('TRCK', 'trkn', 'tracknumber', 'tracktotal'),
                   'totalTracks': ('TRCK', 'trkn', 'tracknumber', 'tracktotal'),
                   'discNumber': ('TPOS', 'disk', 'discnumber', 'disctotal'),
                   'totalDiscs': ('TPOS', 'disk', 'discnumber', 'disctotal')}
        if field in numeric:
            frame, atom, number, total = numeric[field]
            if is_id3(audio):
                audio.tags.delall(frame)
            elif isinstance(audio, MP4):
                audio.tags.pop(atom, None)
            else:
                for key in [number, total, 'totaltracks' if total == 'tracktotal' else 'totaldiscs']:
                    if key in audio.tags:
                        del audio.tags[key]
            continue
        if field not in FIELDS:
            raise ValueError('Unsupported field to clear: ' + field)
        frame, atom, comment = FIELDS[field]
        if is_id3(audio):
            audio.tags.delall(frame if frame.startswith('T') and len(frame) == 4 else 'TXXX:' + frame)
            if field == 'musicbrainzRecordingId':
                audio.tags.delall('UFID:http://musicbrainz.org')
        elif isinstance(audio, MP4):
            audio.tags.pop(atom, None)
        else:
            if comment in audio.tags:
                del audio.tags[comment]


def main(payload):
    source = payload['filepath']
    ext = os.path.splitext(source)[1].lower()
    if ext not in {'.mp3', '.m4a', '.flac', '.opus', '.ogg', '.wav'}:
        raise ValueError('Unsupported music format: ' + ext)
    if payload.get('operation') == 'inspect':
        audio = mutagen.File(source)
        if audio is None or audio.info.length <= 0:
            raise ValueError('File contains no readable audio')
        return {'tags': read_tags(audio), 'artwork': has_artwork(audio), 'duration': audio.info.length,
                'proposed': expected_tags(payload.get('metadata', {})), 'format': ext[1:]}
    expected_hash = payload.get('expectedSha256')
    if expected_hash and digest_file(source) != expected_hash:
        raise ValueError('Audio file changed since preview; inspect it again')
    fd, temporary = tempfile.mkstemp(prefix='.music-tags-', suffix=ext, dir=os.path.dirname(source))
    os.close(fd)
    try:
        shutil.copy2(source, temporary)
        audio = mutagen.File(temporary)
        if audio is None or audio.info.length <= 0:
            raise ValueError('File contains no readable audio')
        if audio.tags is None:
            audio.add_tags()
        if payload.get('scrub', True):
            audio.tags.clear()
            if isinstance(audio, FLAC):
                audio.clear_pictures()
        clear_fields(audio, payload.get('clearFields', []))
        expected = expected_tags(payload.get('metadata', {}))
        if 'selectedFields' in payload:
            expected = {key: value for key, value in expected.items() if key in payload['selectedFields']}
        write_tags(audio, expected)
        if payload.get('artwork'):
            write_artwork(audio, payload['artwork'])
        audio.save()
        verified = mutagen.File(temporary)
        tags = read_tags(verified)
        for key, value in expected.items():
            if tags.get(key) != value:
                raise ValueError('Tag verification failed for ' + key)
        if any(field in tags for field in payload.get('clearFields', []) if field not in expected):
            raise ValueError('Tag clearing verification failed')
        artwork = has_artwork(verified)
        if payload.get('artwork') and not artwork:
            raise ValueError('Artwork verification failed')
        with open(temporary, 'rb') as handle:
            os.fsync(handle.fileno())
        published_revision = digest_file(temporary)
        if expected_hash and digest_file(source) != expected_hash:
            raise ValueError('Audio file changed during tagging; original retained')
        os.replace(temporary, source)
        return {'tagged': True, 'verified': True, 'artwork': artwork, 'tags': tags,
                'duration': verified.info.length, 'revision': published_revision, 'tagger': 'Mutagen ' + mutagen.version_string}
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == '__main__':
    try:
        print(json.dumps(main(json.load(sys.stdin))))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

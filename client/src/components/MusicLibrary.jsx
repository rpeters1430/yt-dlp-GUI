import React, {useCallback,useEffect,useRef,useState} from 'react';
import {api} from '../api.js';
import Drawer from './Drawer.jsx';
import {catalogTrackId} from '../musicCatalog.js';

const show=value=>value==null ? '—' : Array.isArray(value) ? value.join('; ') : String(value);
export default function MusicLibrary({metadataSource='itunes',onCatalogChange}) {
  const [catalog,setCatalog]=useState(metadataSource);
  const [folder,setFolder]=useState('');
  const [listing,setListing]=useState({files:[],truncated:false});
  const [history,setHistory]=useState([]);
  const [busy,setBusy]=useState(false);
  const busyRef=useRef(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [selected,setSelected]=useState(null);
  const [inspection,setInspection]=useState(null);
  const [query,setQuery]=useState('');
  const [releases,setReleases]=useState([]);
  const [release,setRelease]=useState(null);
  const [trackId,setTrackId]=useState('');
  const [review,setReview]=useState(null);
  const [identified,setIdentified]=useState(null);
  const [fingerprint,setFingerprint]=useState({configured:false,available:false});
  const [clientKey,setClientKey]=useState('');

  useEffect(()=>{
    let cancelled=false;
    busyRef.current=true;setBusy(true);
    Promise.all([api.listMusicFiles(),api.musicTagHistory(),api.musicFingerprintSettings()])
      .then(([files,items,status])=>{if(!cancelled){setListing(files);setHistory(items);setFingerprint(status);}})
      .catch(err=>{if(!cancelled)setError(err.message);})
      .finally(()=>{if(!cancelled){busyRef.current=false;setBusy(false);}});
    return ()=>{cancelled=true;};
  },[]);
  async function run(action) {
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setError('');setMessage('');
    try{await action();}catch(err){setError(err.message);}finally{busyRef.current=false;setBusy(false);}
  }
  async function refreshHistory(){setHistory(await api.musicTagHistory());}
  const close=useCallback(()=>{if(!busyRef.current){setSelected(null);setReview(null);setInspection(null);}},[]);
  function open(file) {
    run(async()=>{
      setSelected(file.path);setInspection(null);setRelease(null);setReleases([]);setTrackId('');setReview(null);setIdentified(null);
      const info=await api.inspectMusicFile(file.path);
      setInspection(info);
      setQuery([info.tags.artist,info.tags.album || info.tags.title].filter(Boolean).join(' '));
    });
  }
  async function chooseRelease(id,recordingId='',source=catalog) {
    setReview(null);setTrackId('');
    const data=await api.getMusicAlbum(source==='musicbrainz' ? `mb-${id}` : id);
    setCatalog(source);onCatalogChange?.(source);
    setRelease({...data,catalogSource:source,catalogId:String(id)});
    setTrackId(data.tracks.find(track=>track.musicbrainzRecordingId===recordingId)?.musicbrainzReleaseTrackId || '');
  }
  return <section className="music-library">
    <div className="section-head"><h2>Music library</h2></div>
    <p className="mono-meta">Inspect existing music, choose the correct release, and review tag changes before applying. Original files are backed up for restore. Filenames stay unchanged.</p>
    {!selected && error && <div className="notice notice-danger" role="alert">{error}</div>}
    {!selected && message && <p role="status">{message}</p>}
    <form className="toolbar" onSubmit={event=>{event.preventDefault();run(async()=>setListing(await api.listMusicFiles(folder)));}}>
      <input className="input" aria-label="Music subfolder" placeholder="Subfolder, for example Artist/Album (blank for library)" value={folder} onChange={event=>setFolder(event.target.value)} disabled={busy}/>
      <button className="btn btn-primary" disabled={busy} type="submit">{busy?'Working…':'Browse'}</button>
    </form>
    {listing.truncated && <p className="notice">Showing a bounded selection. Enter an artist or album subfolder to see more files.</p>}
    <div className="library-file-list" style={{display:'grid',gap:6,margin:'12px 0'}}>
      {listing.files.map(file=><button className="btn" style={{textAlign:'left',whiteSpace:'normal',overflowWrap:'anywhere'}} key={file.path} disabled={busy} onClick={()=>open(file)}>{file.path}</button>)}
      {!busy && listing.files.length===0 && <p>No supported music files found in this folder.</p>}
    </div>
    <details style={{margin:'20px 0'}}>
      <summary>Optional audio identification</summary>
      <p>Chromaprint creates an audio fingerprint. Identification sends the fingerprint and duration to AcoustID, without uploading the audio file. Suggested matches still need review.</p>
      <p className="mono-meta">{fingerprint.available?'Chromaprint is available.':'Chromaprint is unavailable. Update the container image or install fpcalc.'} {fingerprint.configured?'An application key is configured.':'Manual MusicBrainz selection works without a key.'}</p>
      <p><a href="https://acoustid.org/new-application" target="_blank" rel="noreferrer">Get a free AcoustID application key</a></p>
      <form onSubmit={event=>{event.preventDefault();run(async()=>{setFingerprint(await api.saveMusicFingerprintSettings(clientKey));setClientKey('');setMessage('Application key saved.');});}}>
        <label>Application key <input className="input" type="password" autoComplete="off" value={clientKey} onChange={event=>setClientKey(event.target.value)} disabled={busy}/></label>
        <button className="btn" disabled={busy || !clientKey.trim()}>Save key</button>
        {fingerprint.configured && !fingerprint.environmentKey && <button type="button" className="btn" disabled={busy} onClick={()=>run(async()=>{setFingerprint(await api.saveMusicFingerprintSettings(''));setMessage('Application key removed.');})}>Remove key</button>}
      </form>
    </details>
    <details style={{margin:'20px 0'}}>
      <summary>Recent tag reviews and restore</summary>
      {history.map(item=><div key={item.id} style={{display:'flex',flexWrap:'wrap',gap:8,padding:'8px 0',alignItems:'center'}}>
        <span style={{overflowWrap:'anywhere',flex:1}}>{item.path} · {item.status}</span>
        {item.status==='applied' && <button className="btn" disabled={busy} onClick={()=>run(async()=>{await api.restoreMusicTags(item.id);await refreshHistory();setMessage('Original file restored.');})}>Restore original</button>}
        {['applying','failed'].includes(item.status) && <small>The original backup is retained. {item.error || 'Review was interrupted; inspect the file before recovery.'}</small>}
      </div>)}
      {!history.length && <p>No tag changes reviewed yet.</p>}
    </details>
    <Drawer open={!!selected} onClose={close} label="Review music metadata">
      <h2>Review music tags</h2>
      <p style={{overflowWrap:'anywhere'}}>{selected}</p>
      {busy && <p role="status">Working…</p>}
      {error && <div className="notice notice-danger" role="alert">{error}</div>}
      {message && <p role="status">{message}</p>}
      {inspection && <>
        <p className="mono-meta">{inspection.format?.toUpperCase()} · {Math.round(inspection.duration)} seconds · {inspection.artwork?'Existing cover will be preserved':'No embedded cover'}</p>
        <dl>{['title','artist','albumArtist','album','trackNumber','discNumber'].map(field=><React.Fragment key={field}><dt>{field}</dt><dd>{show(inspection.tags[field])}</dd></React.Fragment>)}</dl>
        <button className="btn" disabled={busy || !fingerprint.configured || !fingerprint.available} onClick={()=>run(async()=>setIdentified(await api.identifyMusicFile(selected)))}>Identify audio with AcoustID</button>
        {identified && <div>
          <h3>Suggested recordings</h3>
          {!identified.matches.length && <p>No fingerprint match found. Select a release manually below.</p>}
          {identified.matches.map(match=><div key={match.recordingId} style={{margin:'12px 0'}}>
            <strong>{match.artists.join(', ')} — {match.title}</strong><span className="mono-meta"> · {Math.round(match.score*100)}% match score</span>
            {match.releases.map(item=><button className="btn" key={item.id} disabled={busy} onClick={()=>run(()=>chooseRelease(item.id,match.recordingId,'musicbrainz'))}>{item.title}</button>)}
            <button className="text-btn" disabled={busy} onClick={()=>setQuery([...match.artists,match.title].join(' '))}>Use in release search</button>
          </div>)}
        </div>}
        <h3>Choose release and track</h3>
        <label>Metadata catalog <select className="select" value={catalog} disabled={busy} onChange={event=>{
          const source=event.target.value;setCatalog(source);onCatalogChange?.(source);
          setReleases([]);setRelease(null);setReview(null);setTrackId('');
        }}><option value="itunes">Apple catalog</option><option value="musicbrainz">MusicBrainz releases</option></select></label>
        <form onSubmit={event=>{event.preventDefault();run(async()=>{setReleases((await api.searchMusic(query,'album',catalog)).results || []);setReview(null);});}}>
          <input className="input" aria-label="Search catalog releases" value={query} onChange={event=>setQuery(event.target.value)} disabled={busy}/>
          <button className="btn" disabled={busy || !query.trim()}>Search releases</button>
        </form>
        <div style={{display:'grid',gap:6,margin:'10px 0'}}>{releases.map(item=><button className="btn" disabled={busy} key={item.id} onClick={()=>run(()=>chooseRelease(catalog==='musicbrainz' ? item.musicbrainzReleaseId : item.id))}>{[item.artist,item.name,item.releaseYear,item.country,item.edition].filter(Boolean).join(' · ')}</button>)}</div>
        {release && <>
          <p><strong>{release.album.artist} — {release.album.name}</strong> · {release.album.releaseYear} {release.album.country} {release.album.edition}</p>
          <label>Track <select className="select" style={{maxWidth:'100%'}} value={trackId} disabled={busy} onChange={event=>{setTrackId(event.target.value);setReview(null);}}>
            <option value="">Choose the correct track</option>
            {release.tracks.map(track=><option key={catalogTrackId(track,release.catalogSource)} value={catalogTrackId(track,release.catalogSource)}>Disc {track.discNumber} · {track.trackNumber} · {track.artist} — {track.title}</option>)}
          </select></label>
          <button className="btn btn-primary" disabled={busy || !trackId} onClick={()=>run(async()=>setReview(await api.previewMusicTags({path:selected,releaseId:release.catalogId,releaseTrackId:trackId,source:release.catalogSource})))}>Preview changes</button>
        </>}
        {review && <>
          <h3>Proposed changes</h3>
          <div style={{overflowX:'auto'}}><table><thead><tr><th>Tag</th><th>Current</th><th>Proposed</th></tr></thead><tbody>{review.changes.map(change=><tr key={change.field}><td>{change.field}</td><td style={{overflowWrap:'anywhere'}}>{show(change.before)}</td><td style={{overflowWrap:'anywhere'}}>{show(change.after)}</td></tr>)}</tbody></table></div>
          {!review.changes.length && <p>These tags already match the selected release.</p>}
          <p className="mono-meta">Unrelated tags and embedded artwork are preserved. A backup is retained. If the file changes, this preview cannot be applied.</p>
          <button className="btn btn-primary" disabled={busy || !review.changes.length} onClick={()=>run(async()=>{await api.applyMusicTags(review.id);setInspection(await api.inspectMusicFile(selected));setReview(null);await refreshHistory();setMessage('Tags verified and saved. You can restore the original from Recent tag reviews.');})}>Apply reviewed tags</button>
        </>}
      </>}
    </Drawer>
  </section>;
}

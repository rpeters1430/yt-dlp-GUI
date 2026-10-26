import React from 'react';
const show=value=>value==null?'—':Array.isArray(value)?value.join('; '):String(value);
export const reviewChoices=review=>Object.fromEntries(review.changes.map(change=>[change.field,change.action]));
export default function MusicTagChanges({review,onChange,busy}) {
  return <div style={{overflowX:'auto'}}><table><thead><tr><th>Tag</th><th>Current</th><th>Catalog value</th><th>Action</th></tr></thead><tbody>{review.changes.map(change=><tr key={change.field}>
    <td>{change.field}</td><td style={{overflowWrap:'anywhere'}}>{show(change.before)}</td><td style={{overflowWrap:'anywhere'}}>{show(change.after)}</td>
    <td><select className="select" aria-label={`Action for ${change.field}`} disabled={busy} value={change.action} onChange={event=>onChange({...review,changes:review.changes.map(item=>item.field===change.field || (event.target.value==='clear' && ((change.field==='trackNumber' && item.field==='totalTracks') || (change.field==='discNumber' && item.field==='totalDiscs')))?{...item,action:event.target.value}:item)})}>
      <option value="keep">Keep current</option>{change.replaceable && <option value="replace">Replace with catalog</option>}{change.clearable && <option value="clear">{['trackNumber','discNumber'].includes(change.field)?'Clear number and total':'Clear tag'}</option>}
    </select></td>
  </tr>)}</tbody></table></div>;
}

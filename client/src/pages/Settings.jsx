import React, { useState } from 'react';
import { api } from '../api.js';

export default function Settings() {
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function handleChangePassword(e) {
    e.preventDefault();
    setMessage('');
    setError('');
    try {
      await api.changePassword(newPassword);
      setMessage('Password updated.');
      setNewPassword('');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="panel">
      <h2>Settings</h2>
      <form onSubmit={handleChangePassword} className="settings-form">
        <label>Change password</label>
        <input
          type="password"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <button type="submit" disabled={!newPassword}>Update password</button>
        {message && <div className="success-text">{message}</div>}
        {error && <div className="error-text">{error}</div>}
      </form>
    </section>
  );
}

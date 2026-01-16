
import React, { useState } from 'react';
import { INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD } from '../constants.js';

export const Auth = ({ onLogin, users }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (email === INITIAL_ADMIN_EMAIL && password === INITIAL_ADMIN_PASSWORD) {
      const adminUser = users.find(u => u.email === INITIAL_ADMIN_EMAIL);
      if (adminUser) {
        onLogin(adminUser);
        return;
      }
    }

    const member = users.find(u => u.email === email);
    if (member) {
        const nameParts = member.name.trim().split(/\s+/);
        const surname = nameParts[nameParts.length - 1];
        if (password === surname) {
            onLogin(member);
            return;
        }
    }

    setError('Invalid credentials.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md bg-white rounded-[32px] p-10 border border-slate-100 shadow-xl">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-6 text-center">Siri Finance</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="email" required className="w-full px-5 py-4 bg-slate-50 border rounded-2xl outline-none" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input type="password" required className="w-full px-5 py-4 bg-slate-50 border rounded-2xl outline-none" placeholder="Password (Surname)" value={password} onChange={e => setPassword(e.target.value)} />
          {error && <p className="text-red-500 text-xs font-bold">{error}</p>}
          <button type="submit" className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl">Sign In</button>
        </form>
      </div>
    </div>
  );
};

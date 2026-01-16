
import React, { useState } from 'react';
import { UserRole, LoanStatus, LoanType } from '../types.js';
import { MONTHLY_CONTRIBUTION } from '../constants.js';
import { calculateNextEMI, getUpcomingObligation, getCommunityPendingDues } from '../services/loanCalculator.js';

const formatINR = (amount) => amount.toLocaleString('en-IN');

export const Dashboard = ({ state, updateState, onLogout }) => {
  const [activeTab, setActiveTab] = useState('holders');
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');

  const { currentUser, users, contributions, loans, initialInterestEarned, bankInterest, syncStatus } = state;
  const isAdmin = currentUser?.role === UserRole.ADMIN;
  const currentCycleMonth = new Date().toISOString().slice(0, 7);

  const totalFund = contributions.filter(c => c.status === 'PAID' && !c.id.startsWith('emi-')).reduce((acc, c) => acc + c.amount, 0);
  const systemInterest = loans.reduce((acc, l) => acc + l.interestCollected, 0) + (initialInterestEarned || 0);
  const totalInterestWithBank = systemInterest + (bankInterest || 0);
  const totalRepaidPrincipal = loans.reduce((acc, l) => acc + l.repaidAmount, 0);
  const totalDisbursed = loans.filter(l => l.status === LoanStatus.APPROVED || l.status === LoanStatus.PAID).reduce((acc, l) => acc + l.amount, 0);
  const liquidity = totalFund + totalInterestWithBank - totalDisbursed + totalRepaidPrincipal;

  const handleRecordContribution = (userId) => {
    updateState(prev => ({
      ...prev,
      contributions: [...prev.contributions, {
        id: `c-${Date.now()}`, userId, month: currentCycleMonth, amount: MONTHLY_CONTRIBUTION, status: 'PAID'
      }]
    }));
  };

  const handleRecordEMI = (loan) => {
    const emi = calculateNextEMI(loan);
    if (!emi) return;
    updateState(prev => ({
      ...prev,
      loans: prev.loans.map(l => l.id === loan.id ? {
        ...l,
        principalRemaining: emi.remainingBalance,
        repaidAmount: l.repaidAmount + emi.principalComponent,
        interestCollected: l.interestCollected + emi.interestComponent,
        monthsElapsed: l.monthsElapsed + 1,
        lastPaymentMonth: currentCycleMonth,
        status: emi.remainingBalance <= 0 ? LoanStatus.PAID : l.status
      } : l),
      contributions: [...prev.contributions, {
        id: `emi-${Date.now()}`, userId: loan.userId, month: currentCycleMonth, amount: Math.round(emi.totalEMI), status: 'PAID'
      }]
    }));
  };

  const handleAddMember = (e) => {
    e.preventDefault();
    const newUser = { id: `member-${Date.now()}`, name: newMemberName, email: newMemberEmail, role: UserRole.MEMBER, joinedDate: new Date().toISOString().split('T')[0] };
    updateState(prev => ({ ...prev, users: [...prev.users, newUser] }));
    setShowMemberModal(false);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Siri Finance</h1>
        <button onClick={onLogout} className="text-sm font-bold text-slate-500">Logout</button>
      </header>
      <main className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="premium-card p-6">
            <p className="text-xs font-bold text-slate-400 uppercase">Total Pool</p>
            <p className="text-2xl font-black">₹{formatINR(totalFund + totalInterestWithBank)}</p>
          </div>
          <div className="premium-card p-6">
            <p className="text-xs font-bold text-slate-400 uppercase">Available Cash</p>
            <p className="text-2xl font-black">₹{formatINR(liquidity)}</p>
          </div>
          <div className="premium-card p-6 bg-slate-900 text-white">
            <p className="text-xs font-bold text-slate-500 uppercase">Cloud Sync</p>
            <p className="text-lg font-bold">{syncStatus === 'success' ? 'Connected' : 'Syncing...'}</p>
          </div>
        </div>
        <div className="premium-card overflow-hidden">
          <div className="flex border-b">
            <button onClick={() => setActiveTab('holders')} className={`px-6 py-4 font-bold text-sm ${activeTab === 'holders' ? 'border-b-2 border-slate-900' : 'text-slate-400'}`}>Members</button>
            <button onClick={() => setActiveTab('history')} className={`px-6 py-4 font-bold text-sm ${activeTab === 'history' ? 'border-b-2 border-slate-900' : 'text-slate-400'}`}>History</button>
          </div>
          <div className="p-6">
            {activeTab === 'holders' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {users.filter(u => u.role !== UserRole.ADMIN).map(u => {
                   const isPaid = contributions.some(c => c.userId === u.id && c.month === currentCycleMonth && !c.id.startsWith('emi-'));
                   const loan = loans.find(l => l.userId === u.id && l.status === LoanStatus.APPROVED);
                   const emiPaid = loan?.lastPaymentMonth === currentCycleMonth;
                   return (
                     <div key={u.id} className="p-4 border rounded-2xl bg-slate-50/50">
                        <p className="font-bold">{u.name}</p>
                        {isAdmin && (
                          <div className="mt-4 flex flex-col gap-2">
                            {!isPaid && <button onClick={() => handleRecordContribution(u.id)} className="bg-slate-900 text-white text-[10px] py-2 rounded-lg font-bold">Record ₹2000</button>}
                            {loan && !emiPaid && <button onClick={() => handleRecordEMI(loan)} className="bg-amber-500 text-white text-[10px] py-2 rounded-lg font-bold">Record EMI</button>}
                          </div>
                        )}
                     </div>
                   )
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};


import React, { useState, useEffect, useMemo } from 'react';
import { AppState, UserRole, LoanStatus, LoanType, Loan, User, Contribution } from '../types';
import { MONTHLY_CONTRIBUTION } from '../constants';
import { calculateNextEMI, getUpcomingObligation, getCommunityPendingDues } from '../services/loanCalculator';
import { getFinancialAdvice } from '../services/geminiService';
import { pushToCloud } from '../services/syncService';

interface DashboardProps {
  state: AppState;
  updateState: (updater: Partial<AppState> | ((prev: AppState) => AppState)) => void;
  onLogout: () => void;
}

const getCurrentCycleMonth = () => new Date().toISOString().slice(0, 7);

const getUpcomingMonthInfo = (cycleMonth: string) => {
  const [year, month] = cycleMonth.split('-').map(Number);
  const date = new Date(year, month, 10); 
  return {
    day: "10th",
    monthName: date.toLocaleString('default', { month: 'long' }),
    year: date.getFullYear()
  };
};

// Helper for Indian Currency Formatting
const formatINR = (amount: number) => {
  return amount.toLocaleString('en-IN');
};

export const Dashboard: React.FC<DashboardProps> = ({ state, updateState, onLogout }) => {
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showBankInterestModal, setShowBankInterestModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'holders' | 'dues' | 'loans' | 'history' | 'system'>('holders');
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSyncingManually, setIsSyncingManually] = useState(false);
  
  const [newLoanType, setNewLoanType] = useState<LoanType>(LoanType.SHORT_TERM);
  const [newLoanAmount, setNewLoanAmount] = useState(0);
  
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [tempBankInterest, setTempBankInterest] = useState(state.bankInterest || 0);
  
  const { currentUser, users, contributions, loans, initialInterestEarned, bankInterest, syncStatus } = state;
  const isAdmin = currentUser?.role === UserRole.ADMIN;
  const currentCycleMonth = getCurrentCycleMonth();
  const upcoming = getUpcomingMonthInfo(currentCycleMonth);

  const paidContributions = contributions.filter(c => c.status === 'PAID' && !c.id.startsWith('emi-'));
  const totalFund = paidContributions.reduce((acc, c) => acc + c.amount, 0);
  
  const systemInterest = loans.reduce((acc, l) => acc + l.interestCollected, 0) + (initialInterestEarned || 0);
  const totalInterestWithBank = systemInterest + (bankInterest || 0);
  
  const totalRepaidPrincipal = loans.reduce((acc, l) => acc + l.repaidAmount, 0);
  const totalDisbursed = loans.filter(l => l.status === LoanStatus.APPROVED || l.status === LoanStatus.PAID).reduce((acc, l) => acc + l.amount, 0);
  const liquidity = totalFund + totalInterestWithBank - totalDisbursed + totalRepaidPrincipal;

  const totalPoolValue = totalFund + totalInterestWithBank;

  const duesValue = isAdmin 
    ? getCommunityPendingDues(users, loans, contributions, currentCycleMonth)
    : getUpcomingObligation(currentUser?.id || '', loans);

  // Derived Notifications from Loan Requests
  const notifications = useMemo(() => {
    return loans
      .filter(l => l.status !== LoanStatus.PAID) // Only show active/pending/rejected
      .sort((a, b) => b.id.localeCompare(a.id))
      .slice(0, 5)
      .map(l => {
        const user = users.find(u => u.id === l.userId);
        return {
          id: l.id,
          userName: user?.name || 'Unknown',
          amount: l.amount,
          status: l.status,
          date: l.requestDate,
          type: l.type
        };
      });
  }, [loans, users]);

  useEffect(() => {
    const fetchAiAdvice = async () => {
      setIsAiLoading(true);
      const advice = await getFinancialAdvice(state);
      setAiAdvice(advice);
      setIsAiLoading(false);
    };
    fetchAiAdvice();
  }, [state.lastUpdated]);

  const handleRecordContribution = (userId: string) => {
    const exists = contributions.find(c => c.userId === userId && c.month === currentCycleMonth && !c.id.startsWith('emi-') && c.status === 'PAID');
    if (exists) return;
    updateState(prev => ({
      ...prev,
      contributions: [...prev.contributions, {
        id: `c-${Date.now()}`, userId, month: currentCycleMonth, amount: MONTHLY_CONTRIBUTION, status: 'PAID'
      }]
    }));
  };

  const handleRecordEMI = (loan: Loan) => {
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
        id: `emi-${Date.now()}`,
        userId: loan.userId,
        month: currentCycleMonth,
        amount: Math.round(emi.totalEMI),
        status: 'PAID'
      }]
    }));
  };

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberName || !newMemberEmail) return;
    
    const newUser: User = {
      id: `member-${Date.now()}`,
      name: newMemberName,
      email: newMemberEmail,
      role: UserRole.MEMBER,
      joinedDate: new Date().toISOString().split('T')[0]
    };

    updateState(prev => ({
      ...prev,
      users: [...prev.users, newUser]
    }));

    setNewMemberName('');
    setNewMemberEmail('');
    setShowMemberModal(false);
  };

  const handleDeleteMember = (userId: string, userName: string) => {
    if (window.confirm(`Are you sure you want to remove ${userName} from the community? This action will sync to the cloud.`)) {
      updateState(prev => ({
        ...prev,
        users: prev.users.filter(u => u.id !== userId)
      }));
    }
  };

  const handleSaveBankInterest = () => {
    updateState(prev => ({ ...prev, bankInterest: tempBankInterest }));
    setShowBankInterestModal(false);
  };

  const handleForceSync = async () => {
    if (!isAdmin) return;
    setIsSyncingManually(true);
    try {
      await pushToCloud(state);
      updateState({ syncStatus: 'success' });
    } catch (e) {
      updateState({ syncStatus: 'error' });
    } finally {
      setIsSyncingManually(false);
    }
  };

  const handleApproveLoan = (loanId: string) => {
    updateState(prev => ({
      ...prev,
      loans: prev.loans.map(l => l.id === loanId ? { ...l, status: LoanStatus.APPROVED, approvalDate: new Date().toISOString() } : l)
    }));
  };

  const handleRejectLoan = (loanId: string) => {
    updateState(prev => ({
      ...prev,
      loans: prev.loans.map(l => l.id === loanId ? { ...l, status: LoanStatus.REJECTED } : l)
    }));
  };

  const getSyncLabel = () => {
    if (syncStatus === 'success') return 'Cloud Active';
    if (syncStatus === 'syncing') return 'Syncing...';
    if (syncStatus === 'error') return 'Local Mode (Cloud Error)';
    return 'Local Mode';
  };

  return (
    <div className="flex flex-col min-h-screen pb-24">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-900 rounded-2xl flex items-center justify-center shadow-sm">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight text-slate-900">Siri Finance</h1>
              <div className="flex items-center gap-1.5">
                <div className={`h-1.5 w-1.5 rounded-full ${syncStatus === 'success' ? 'bg-emerald-500' : (syncStatus === 'error' ? 'bg-rose-500' : 'bg-slate-300')}`}></div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{getSyncLabel()}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 sm:gap-6">
            <div className="hidden md:block text-right">
              <p className="text-sm font-bold text-slate-900">{currentUser?.name}</p>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{currentUser?.role}</p>
            </div>
            
            <button onClick={onLogout} className="p-2.5 text-slate-400 hover:text-slate-900 transition-colors">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-10 space-y-10">
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-6 animate-in fade-in slide-in-from-top-4 duration-500">
          <div>
            <h2 className="text-4xl font-extrabold text-slate-900 tracking-tight accent-text">
              Welcome, {currentUser?.name}
            </h2>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-2">
              {isAdmin ? "Financial Control Center" : "Member Contribution Portal"}
            </p>
          </div>
          {isAdmin && (
            <button 
              onClick={() => setShowMemberModal(true)}
              className="px-6 py-3 bg-white border border-slate-200 text-slate-900 rounded-2xl font-bold text-xs uppercase tracking-widest hover:border-slate-900 transition-all flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M12 4v16m8-8H4" /></svg>
              Add New Member
            </button>
          )}
        </section>

        {/* New Notifications Section */}
        <section className="premium-card p-6 border-none shadow-sm bg-slate-900 text-white overflow-hidden relative">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Recent Community Activities</h3>
            <span className="px-2 py-1 bg-indigo-500 text-white text-[8px] font-black rounded uppercase tracking-widest">LIVE</span>
          </div>
          <div className="flex flex-col gap-3">
            {notifications.length > 0 ? (
              notifications.map((n) => (
                <div key={n.id} className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/5 hover:bg-white/10 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${n.status === LoanStatus.PENDING ? 'bg-amber-400 animate-pulse' : (n.status === LoanStatus.APPROVED ? 'bg-emerald-400' : 'bg-rose-400')}`}></div>
                    <div>
                      <p className="text-xs font-bold">
                        <span className="text-indigo-300">{n.userName}</span>
                        {n.status === LoanStatus.PENDING ? ' requested ' : (n.status === LoanStatus.APPROVED ? ' approved for ' : ' rejected for ')}
                        <span className="text-white">₹{formatINR(n.amount)}</span>
                      </p>
                      <p className="text-[8px] font-black uppercase text-slate-500 tracking-widest mt-0.5">{n.type.replace('_', ' ')} • {n.date}</p>
                    </div>
                  </div>
                  <div className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${n.status === LoanStatus.PENDING ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20' : (n.status === LoanStatus.APPROVED ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20' : 'bg-rose-400/10 text-rose-400 border border-rose-400/20')}`}>
                    {n.status}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest py-4 text-center">No recent loan requests or status updates</p>
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="premium-card p-8 bg-white transition-all hover:border-slate-300 border-l-4 border-l-indigo-500">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Community Pool</p>
            <h3 className="text-3xl font-extrabold text-slate-900 accent-text">₹{formatINR(totalPoolValue)}</h3>
            <p className="mt-4 text-[9px] font-black text-slate-500 uppercase tracking-widest leading-relaxed">
              Contrib: <span className="text-slate-900">₹{formatINR(totalFund)}</span><br/>
              + Total Interest: <span className="text-emerald-600">₹{formatINR(totalInterestWithBank)}</span>
            </p>
          </div>
          
          <div className="premium-card p-8 transition-all hover:border-slate-300">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Available Cash</p>
            <h3 className="text-3xl font-extrabold text-slate-900 accent-text">₹{formatINR(liquidity)}</h3>
            <div className="mt-4 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
               <div className="h-full bg-slate-900 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (liquidity/totalFund)*100)}%` }}></div>
            </div>
          </div>

          <div className="premium-card p-8 border-l-4 border-l-emerald-500 transition-all hover:border-slate-300 relative group">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Accrued Interest</p>
            <h3 className="text-3xl font-extrabold text-emerald-600 accent-text">₹{formatINR(totalInterestWithBank)}</h3>
            
            <div className="mt-4 space-y-2">
              <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-slate-400">
                <span>Auto-Calc System</span>
                <span className="text-slate-900">₹{formatINR(systemInterest)}</span>
              </div>
              <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-slate-400">
                <span>Manual Bank</span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-900">₹{formatINR(bankInterest || 0)}</span>
                  {isAdmin && (
                    <button 
                      onClick={() => {
                        setTempBankInterest(bankInterest || 0);
                        setShowBankInterestModal(true);
                      }}
                      className="px-2 py-0.5 bg-slate-900 text-white rounded text-[8px] hover:bg-slate-800 transition-all opacity-0 group-hover:opacity-100"
                    >
                      EDIT
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="premium-card p-8 bg-slate-900 border-none flex flex-col justify-between shadow-2xl shadow-slate-200">
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">{isAdmin ? 'Pending Dues' : 'My Dues'}</p>
              <h3 className="text-3xl font-extrabold text-white accent-text">₹{formatINR(duesValue)}</h3>
            </div>
            <div className="mt-4 space-y-1">
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Current Cycle: {currentCycleMonth}</p>
              {!isAdmin && (
                <p className="text-[10px] font-bold text-amber-400 uppercase tracking-tight">
                  Due date: {upcoming.day} of {upcoming.monthName} {upcoming.year}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="premium-card p-8 bg-slate-50 border-none border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-1.5 bg-slate-900 rounded-lg">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h4 className="text-xs font-black uppercase tracking-[0.2em] text-slate-900">Siri AI Intelligence</h4>
          </div>
          {isAiLoading ? (
            <div className="flex items-center gap-3 py-4">
              <div className="h-4 w-4 border-2 border-slate-900/20 border-t-slate-900 animate-spin rounded-full"></div>
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-50 text-slate-900">Analyzing community ledger...</p>
            </div>
          ) : (
            <div className="text-sm leading-relaxed text-slate-600 max-w-3xl prose prose-slate prose-sm">
              {aiAdvice}
            </div>
          )}
        </section>

        <section className="premium-card overflow-hidden">
          <div className="px-8 py-8 border-b border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6">
            <h4 className="font-extrabold text-slate-900 uppercase tracking-widest text-xs">Community Ledger</h4>
            <div className="bg-slate-50 p-1.5 rounded-2xl flex gap-1 flex-wrap justify-center">
              {[
                {id: 'holders', label: isAdmin ? 'Members' : 'Community'},
                ...(!isAdmin ? [{id: 'dues', label: 'My Dues'}] : []),
                {id: 'loans', label: isAdmin ? 'Requests' : 'My Loans'},
                {id: 'history', label: 'Activity'},
                ...(isAdmin ? [{id: 'system', label: 'System'}] : [])
              ].map((t) => (
                <button 
                  key={t.id} 
                  onClick={() => setActiveTab(t.id as any)}
                  className={`px-6 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === t.id ? 'bg-white text-slate-900 shadow-sm border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-8">
            {activeTab === 'holders' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {users.filter(u => u.role !== UserRole.ADMIN).map(u => {
                  const approvedLoan = loans.find(l => l.userId === u.id && l.status === LoanStatus.APPROVED);
                  const isContributionPaid = contributions.some(c => c.userId === u.id && c.month === currentCycleMonth && !c.id.startsWith('emi-') && c.status === 'PAID');
                  const isEmiPaid = approvedLoan?.lastPaymentMonth === currentCycleMonth;
                  const recordedEmiContribution = contributions.find(c => c.userId === u.id && c.month === currentCycleMonth && c.id.startsWith('emi-') && c.status === 'PAID');
                  const totalMemberPaid = contributions.filter(c => c.userId === u.id && c.status === 'PAID').reduce((sum, c) => sum + c.amount, 0);
                  
                  const currentEmiDetails = approvedLoan ? calculateNextEMI(approvedLoan) : null;

                  return (
                    <div key={u.id} className="p-6 bg-slate-50/30 rounded-3xl border border-slate-100 flex flex-col justify-between group hover:border-slate-300 transition-all relative">
                      {isAdmin && (
                        <button 
                          onClick={() => handleDeleteMember(u.id, u.name)}
                          className="absolute top-4 right-4 p-2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                          title="Remove Member"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                      
                      <div className="flex justify-between items-start mb-4">
                        <div className="h-10 w-10 bg-white rounded-xl border border-slate-100 flex items-center justify-center font-bold text-slate-900 shadow-sm">{u.name.charAt(0)}</div>
                      </div>
                      
                      <div className="space-y-1 mb-4">
                        <p className="text-sm font-extrabold text-slate-900">{u.name}</p>
                        <p className="text-[10px] text-slate-400 font-bold">{u.email}</p>
                        <p className="text-[10px] text-emerald-600 font-black uppercase tracking-widest pt-1">Contribution Total: ₹{formatINR(totalMemberPaid)}</p>
                      </div>

                      <div className="pt-4 border-t border-slate-100/50 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-black text-slate-300 uppercase">Principal Left</span>
                          <span className="text-xs font-extrabold text-slate-900">{approvedLoan ? `₹${formatINR(approvedLoan.principalRemaining)}` : 'None'}</span>
                        </div>
                        {approvedLoan && !isEmiPaid && currentEmiDetails && (
                           <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black text-amber-400 uppercase">Monthly EMI</span>
                            <span className="text-xs font-extrabold text-amber-600">₹{formatINR(Math.round(currentEmiDetails.totalEMI))}</span>
                          </div>
                        )}
                      </div>

                      {isAdmin && (
                        <div className="mt-4 pt-4 border-t border-slate-100/50 flex flex-col gap-2">
                          {!isContributionPaid ? (
                            <button 
                              onClick={() => handleRecordContribution(u.id)}
                              className="w-full py-2.5 bg-slate-900 text-white text-[10px] font-black rounded-xl uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
                            >
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 4v16m8-8H4" strokeWidth={3}/></svg>
                              Record ₹2,000
                            </button>
                          ) : (
                            <div className="w-full py-2.5 bg-emerald-50 text-emerald-600 text-[10px] font-black rounded-xl uppercase tracking-widest flex items-center justify-center gap-2">
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth={3}/></svg>
                              ₹2k Recorded
                            </div>
                          )}

                          {approvedLoan && (
                            !isEmiPaid ? (
                              currentEmiDetails ? (
                                <button 
                                  onClick={() => handleRecordEMI(approvedLoan)}
                                  className="w-full py-2.5 bg-amber-500 text-white text-[10px] font-black rounded-xl uppercase tracking-widest hover:bg-amber-600 transition-all flex items-center justify-center gap-2"
                                >
                                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth={2.5}/></svg>
                                  Record EMI: ₹{formatINR(Math.round(currentEmiDetails.totalEMI))}
                                </button>
                              ) : (
                                <div className="w-full py-2.5 bg-slate-50 text-slate-400 text-[9px] font-bold rounded-xl uppercase tracking-widest text-center">
                                  Term Settlement Pending
                                </div>
                              )
                            ) : (
                              <div className="w-full py-2.5 bg-indigo-50 text-indigo-600 text-[10px] font-black rounded-xl uppercase tracking-widest flex items-center justify-center gap-2">
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth={3}/></svg>
                                EMI ₹{formatINR(recordedEmiContribution?.amount || 0)} Settled
                              </div>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'dues' && !isAdmin && currentUser && (
              <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4">
                <div className="bg-slate-900 rounded-[32px] p-10 text-white space-y-6">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Cycle Obligation</h4>
                      <p className="text-4xl font-extrabold">₹{formatINR(duesValue)}</p>
                    </div>
                    <div className="bg-amber-400/10 border border-amber-400/20 px-4 py-2 rounded-2xl">
                      <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-1">Due Date</p>
                      <p className="text-sm font-extrabold text-amber-400">{upcoming.day} {upcoming.monthName} {upcoming.year}</p>
                    </div>
                  </div>
                  
                  <div className="pt-6 border-t border-slate-800 space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-400 font-medium">Monthly Contribution</span>
                      <span className="text-sm font-bold text-white">₹{formatINR(MONTHLY_CONTRIBUTION)}</span>
                    </div>
                    {loans.filter(l => l.userId === currentUser.id && l.status === LoanStatus.APPROVED).map(l => {
                      const emi = calculateNextEMI(l);
                      if (!emi) return null;
                      return (
                        <div key={l.id} className="flex justify-between items-center">
                          <span className="text-sm text-slate-400 font-medium">Loan EMI ({l.type.replace('_', ' ')})</span>
                          <span className="text-sm font-bold text-white">₹{formatINR(Math.round(emi.totalEMI))}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-white border border-slate-100 rounded-[32px] p-8 space-y-4">
                  <div className="flex items-center gap-3 text-slate-900 mb-2">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <h5 className="text-sm font-extrabold uppercase tracking-widest">Payment Instructions</h5>
                  </div>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Please ensure your dues are settled with the community treasurer by the <strong>10th of {upcoming.monthName}</strong>. 
                    Late payments may impact your credit standing for future capital requests.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'loans' && (
              <div className="space-y-4">
                {loans.filter(l => isAdmin || l.userId === currentUser?.id).length === 0 ? (
                  <div className="py-20 text-center text-slate-300 font-bold uppercase text-[10px] tracking-[0.3em]">No Disbursal Records</div>
                ) : (
                  loans.filter(l => isAdmin || l.userId === currentUser?.id).slice().reverse().map(l => (
                    <div key={l.id} className="flex flex-col sm:flex-row items-center justify-between p-7 bg-slate-50/50 border border-slate-100 rounded-[32px] hover:bg-white hover:shadow-xl hover:shadow-slate-100 transition-all">
                      <div className="flex items-center gap-5">
                        <div className="h-12 w-12 bg-white rounded-2xl border border-slate-100 flex items-center justify-center text-slate-900">
                          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth={2}/></svg>
                        </div>
                        <div>
                          <p className="text-sm font-extrabold text-slate-900">{users.find(u => u.id === l.userId)?.name}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{l.type.replace('_', ' ')} • {l.requestDate}</p>
                        </div>
                      </div>
                      <div className="mt-4 sm:mt-0 flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-lg font-black text-slate-900">₹{formatINR(l.amount)}</p>
                          <span className={`text-[9px] font-black uppercase tracking-widest ${l.status === LoanStatus.APPROVED ? 'text-emerald-500' : (l.status === LoanStatus.REJECTED ? 'text-rose-500' : 'text-slate-400')}`}>{l.status}</span>
                        </div>
                        {isAdmin && l.status === LoanStatus.PENDING && (
                          <div className="flex gap-2">
                            <button onClick={() => handleApproveLoan(l.id)} className="px-5 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 shadow-lg shadow-slate-200 active:scale-95 transition-all">Approve</button>
                            <button onClick={() => handleRejectLoan(l.id)} className="px-5 py-3 bg-rose-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-600 shadow-lg shadow-rose-200 active:scale-95 transition-all">Reject</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {contributions.filter(c => isAdmin || c.userId === currentUser?.id).length === 0 ? (
                   <div className="py-20 text-center text-slate-300 font-bold uppercase text-[10px] tracking-[0.3em]">No Recent Activity</div>
                ) : (
                  contributions.filter(c => isAdmin || c.userId === currentUser?.id).slice().sort((a,b) => b.id.localeCompare(a.id)).sort((a,b) => b.month.localeCompare(a.month)).map(c => (
                    <div key={c.id} className="flex items-center justify-between p-5 bg-white border border-slate-50 rounded-2xl hover:border-slate-200 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className={`w-2 h-2 rounded-full ${c.id.startsWith('emi-') ? 'bg-indigo-400' : 'bg-emerald-400'}`}></div>
                        <div>
                          <p className="text-xs font-bold text-slate-900">{users.find(u => u.id === c.userId)?.name}</p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{c.id.startsWith('emi-') ? 'EMI Payment' : 'Contribution'}: {c.month}</p>
                        </div>
                      </div>
                      <p className={`text-sm font-black ${c.id.startsWith('emi-') ? 'text-indigo-600' : 'text-slate-900'}`}>+₹{formatINR(c.amount)}</p>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'system' && isAdmin && (
              <div className="max-w-2xl mx-auto space-y-6">
                <div className="p-8 bg-slate-50 rounded-[32px] border border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-6">
                  <div>
                    <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-1">Cloud Database Status</h4>
                    <p className="text-xs font-medium text-slate-500">Connected to merziznywkwwlyixzkzs.supabase.co</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${syncStatus === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                      {syncStatus === 'success' ? 'Synchronized' : 'Offline Mode'}
                    </span>
                  </div>
                </div>

                <div className="p-8 bg-white border border-slate-100 rounded-[32px] space-y-6">
                  <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">Community Settings</h4>
                  <div className="space-y-4">
                    <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Update Interest from Bank (Manual Entry)</label>
                      <div className="flex gap-4">
                         <div className="relative flex-1">
                            <span className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                            <input 
                              type="number" 
                              className="w-full pl-10 pr-6 py-4 bg-white border border-slate-200 rounded-2xl outline-none font-bold text-slate-900 focus:ring-4 focus:ring-slate-100" 
                              value={bankInterest || 0}
                              onChange={(e) => updateState(prev => ({ ...prev, bankInterest: Number(e.target.value) }))}
                            />
                         </div>
                      </div>
                      <p className="mt-3 text-[10px] font-medium text-slate-400 italic">This number should be derived from your physical bank statements.</p>
                    </div>
                  </div>
                </div>

                <div className="p-8 bg-white border border-slate-100 rounded-[32px] space-y-6">
                  <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">Maintenance Tasks</h4>
                  <div className="grid grid-cols-1 gap-4">
                    <button 
                      onClick={handleForceSync}
                      disabled={isSyncingManually}
                      className="flex items-center justify-between p-5 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-colors group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="p-2 bg-white rounded-lg shadow-sm">
                          <svg className={`h-5 w-5 text-slate-900 ${isSyncingManually ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </div>
                        <div className="text-left">
                          <p className="text-xs font-bold text-slate-900">Force Cloud Push</p>
                          <p className="text-[10px] text-slate-400 font-medium">Upload current community state to Supabase</p>
                        </div>
                      </div>
                      <svg className="h-4 w-4 text-slate-300 group-hover:text-slate-900 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                    </button>

                    <button 
                      onClick={() => {
                        if(confirm("DANGER: This will delete local storage and reset to default. Continue?")) {
                          localStorage.removeItem('memberfund_state_v3');
                          window.location.reload();
                        }
                      }}
                      className="flex items-center justify-between p-5 bg-rose-50 rounded-2xl hover:bg-rose-100 transition-colors group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="p-2 bg-white rounded-lg shadow-sm">
                          <svg className="h-5 w-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </div>
                        <div className="text-left">
                          <p className="text-xs font-bold text-rose-900">Reset Local Ledger</p>
                          <p className="text-[10px] text-rose-400 font-medium">Clears local cache and reloads default state</p>
                        </div>
                      </div>
                      <svg className="h-4 w-4 text-rose-300 group-hover:text-rose-900 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                    </button>
                  </div>
                </div>

                <div className="bg-emerald-50 p-6 rounded-[32px] border border-emerald-100 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <h5 className="text-[10px] font-black text-emerald-900 uppercase tracking-widest">Active State Verification</h5>
                  </div>
                  <ul className="text-[10px] font-bold text-emerald-800 space-y-1.5 opacity-80">
                    <li>• Ledger includes active community members.</li>
                    <li>• Each member: ₹{formatINR(30000)} recorded.</li>
                    <li>• Collection Cycle: {currentCycleMonth} is active.</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {!isAdmin && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50">
          <button 
            onClick={() => setShowLoanModal(true)}
            className="px-10 py-5 bg-slate-900 text-white rounded-3xl font-extrabold text-xs uppercase tracking-widest shadow-2xl shadow-slate-400/50 flex items-center gap-3 hover:-translate-y-1 transition-all active:scale-95"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M12 4v16m8-8H4" /></svg>
            Request Capital
          </button>
        </div>
      )}

      {/* Bank Interest Management Modal */}
      {showBankInterestModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md rounded-[48px] p-10 shadow-2xl space-y-6 animate-in fade-in zoom-in duration-300">
            <div className="text-center">
              <h2 className="text-2xl font-black text-slate-900 mb-2">Bank Interest</h2>
              <p className="text-slate-400 text-sm font-medium">Enter amount manually from statements</p>
            </div>
            <div className="relative">
              <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold text-2xl">₹</span>
              <input 
                type="number" 
                className="w-full pl-12 pr-6 py-6 bg-slate-50 border-none rounded-3xl outline-none font-black text-3xl accent-text focus:ring-4 focus:ring-slate-100" 
                placeholder="0" 
                autoFocus
                value={tempBankInterest} 
                onChange={e => setTempBankInterest(Math.max(0, Number(e.target.value)))} 
              />
            </div>
            <div className="flex flex-col gap-3 pt-4">
              <button 
                onClick={handleSaveBankInterest}
                className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all"
              >
                Apply to Pool
              </button>
              <button 
                onClick={() => setShowBankInterestModal(false)} 
                className="w-full py-3 text-slate-400 text-[10px] font-black uppercase tracking-widest"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showMemberModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <form onSubmit={handleAddMember} className="bg-white w-full max-w-md rounded-[48px] p-10 shadow-2xl space-y-6 animate-in fade-in zoom-in duration-300">
            <div className="text-center mb-4">
              <h2 className="text-2xl font-black text-slate-900 mb-2">New Community Member</h2>
              <p className="text-slate-400 text-sm font-medium">Add a new contributor to the ledger</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Full Name</label>
                <input type="text" required className="w-full px-6 py-4 bg-slate-50 border-none rounded-2xl outline-none font-bold text-slate-900 focus:ring-4 focus:ring-slate-100" placeholder="John Doe" value={newMemberName} onChange={e => setNewMemberName(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Email Address</label>
                <input type="email" required className="w-full px-6 py-4 bg-slate-50 border-none rounded-2xl outline-none font-bold text-slate-900 focus:ring-4 focus:ring-slate-100" placeholder="john@example.com" value={newMemberEmail} onChange={e => setNewMemberEmail(e.target.value)} />
              </div>
              <p className="text-[10px] text-slate-400 font-bold italic text-center">Initial password: Use their second name (surname)</p>
            </div>
            <div className="flex flex-col gap-3 pt-4">
              <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-[24px] font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all">Add to Community</button>
              <button type="button" onClick={() => setShowMemberModal(false)} className="w-full py-3 text-slate-400 text-[10px] font-black uppercase tracking-widest">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {showLoanModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-lg rounded-[48px] p-10 shadow-2xl space-y-8 animate-in fade-in zoom-in duration-300">
            <div className="text-center">
              <h2 className="text-2xl font-black text-slate-900 mb-2">Capital Disbursal</h2>
              <p className="text-slate-400 text-sm font-medium">Configure your repayment structure</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setNewLoanType(LoanType.SHORT_TERM)} className={`py-5 rounded-3xl border-2 font-bold uppercase text-[10px] tracking-widest transition-all ${newLoanType === LoanType.SHORT_TERM ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-50 text-slate-300'}`}>Short Term (2%)</button>
              <button onClick={() => setNewLoanType(LoanType.LONG_TERM)} className={`py-5 rounded-3xl border-2 font-bold uppercase text-[10px] tracking-widest transition-all ${newLoanType === LoanType.LONG_TERM ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-50 text-slate-300'}`}>Long Term (1%)</button>
            </div>
            <div className="relative">
              <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold text-2xl">₹</span>
              <input type="number" className="w-full pl-12 pr-6 py-6 bg-slate-50 border-none rounded-3xl outline-none font-black text-3xl accent-text focus:ring-4 focus:ring-slate-100" placeholder="0" value={newLoanAmount || ''} onChange={e => setNewLoanAmount(Math.abs(Number(e.target.value)))} />
            </div>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => {
                  const l: Loan = { id: `loan-${Date.now()}`, userId: currentUser!.id, type: newLoanType, amount: newLoanAmount, principalRemaining: newLoanAmount, status: LoanStatus.PENDING, requestDate: new Date().toISOString().split('T')[0], repaidAmount: 0, interestCollected: 0, monthsElapsed: 0 };
                  updateState(prev => ({ ...prev, loans: [...prev.loans, l] }));
                  setShowLoanModal(false);
                }}
                className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all"
              >
                Send for Review
              </button>
              <button onClick={() => setShowLoanModal(false)} className="w-full py-3 text-slate-400 text-[10px] font-black uppercase tracking-widest">Discard Request</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

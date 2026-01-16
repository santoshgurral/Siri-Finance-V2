
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User, UserRole, AppState, Contribution, Loan, LoanType, LoanStatus } from './types.js';
import { Auth } from './components/Auth.js';
import { Dashboard } from './components/Dashboard.js';
import { INITIAL_ADMIN_EMAIL } from './constants.js';
import { pushToCloud, pullFromCloud, isCloudEnabled } from './services/syncService.js';

const App = () => {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem('memberfund_state_v3'); 
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.users)) {
          return { 
            ...parsed, 
            currentUser: null,
            syncStatus: 'idle',
            bankInterest: parsed.bankInterest ?? 1684
          };
        }
      }
    } catch (e) {}
    
    const adminUser = { 
      id: 'admin-1', 
      name: 'System Admin', 
      email: INITIAL_ADMIN_EMAIL, 
      role: UserRole.ADMIN, 
      joinedDate: '2023-01-01' 
    };

    const membersData = [
      { name: "Aravind Kumar", email: "aravinds369@gmail.com" },
      { name: "Santosh Gurral", email: "santoshgurral@gmail.com" },
      { name: "Santosh Reddy", email: "santoshreddy119@gmail.com" },
      { name: "Santosh Shetty", email: "archisantoshshetty007@gmail.com" },
      { name: "Santosh Hatti", email: "hattisantosh92@gmail.com" },
      { name: "Shankar Konnur", email: "shankar.konnur007@gmail.com" },
      { name: "Shashank Kulkarni", email: "shashank.physics@gmail.com" },
      { name: "Rajkumar Hatti", email: "hattirajkumar@gmail.com" },
      { name: "Praveenkumar Kavadimatti", email: "praveenkumar.kavadimatti@gmail.com" },
      { name: "Mallikarjun Manur", email: "manur.mallu@gmail.com" },
      { name: "Mallikarjun Junior", email: "extra.mallikarjun@gmail.com" },
      { name: "Vijaykumar Maga", email: "vijaymaga033@gmail.com" },
    ];

    const initialUsers = [adminUser, ...membersData.map((m, idx) => ({
      id: `member-${idx + 1}`, 
      name: m.name, 
      email: m.email, 
      role: UserRole.MEMBER, 
      joinedDate: '2025-11-10'
    }))];

    const initialContributions = [];
    const months = [
      "2024-11", "2024-12", "2025-01", "2025-02", "2025-03", "2025-04", 
      "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", 
      "2025-11", "2025-12", "2026-01"
    ];

    initialUsers.filter(u => u.role === UserRole.MEMBER).forEach(user => {
      months.forEach((month, idx) => {
        initialContributions.push({
          id: `hist-${user.id}-${idx}`,
          userId: user.id,
          month: month,
          amount: 2000,
          status: 'PAID'
        });
      });
    });

    const initialLoans = [];
    const historicalLoansData = [
      { email: "aravinds369@gmail.com", takenDate: "2025-08-10", principal: 100000, balance: 75000 },
      { email: "santoshgurral@gmail.com", takenDate: "2025-12-10", principal: 100000, balance: 95000 },
      { email: "archisantoshshetty007@gmail.com", takenDate: "2026-01-10", principal: 50000, balance: 50000 },
      { email: "hattisantosh92@gmail.com", takenDate: "2025-03-10", principal: 30000, balance: 16500 },
      { email: "hattirajkumar@gmail.com", takenDate: "2025-07-10", principal: 50000, balance: 35000 },
      { email: "extra.mallikarjun@gmail.com", takenDate: "2025-10-10", principal: 100000, balance: 10000 },
      { email: "vijaymaga033@gmail.com", takenDate: "2025-11-10", principal: 30000, balance: 27000 },
    ];

    historicalLoansData.forEach((ld, idx) => {
      const user = initialUsers.find(u => u.email === ld.email);
      if (user) {
        const startDate = new Date(ld.takenDate);
        const endDate = new Date("2026-01-10");
        const diffMonths = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
        
        initialLoans.push({
          id: `hist-loan-${idx}`,
          userId: user.id,
          type: LoanType.LONG_TERM,
          amount: ld.principal,
          principalRemaining: ld.balance,
          status: LoanStatus.APPROVED,
          requestDate: ld.takenDate,
          approvalDate: ld.takenDate,
          repaidAmount: ld.principal - ld.balance,
          interestCollected: 0,
          monthsElapsed: Math.max(0, diffMonths),
          lastPaymentMonth: "2026-01"
        });
      }
    });

    return {
      currentUser: null,
      users: initialUsers,
      contributions: initialContributions,
      loans: initialLoans,
      initialInterestEarned: 20060,
      bankInterest: 1684,
      syncStatus: 'idle',
      lastUpdated: Date.now()
    };
  });

  const lastUpdatedRef = useRef(state.lastUpdated);
  lastUpdatedRef.current = state.lastUpdated;

  useEffect(() => {
    const { currentUser, syncStatus, ...stateToSave } = state;
    localStorage.setItem('memberfund_state_v3', JSON.stringify(stateToSave));
  }, [state.users, state.contributions, state.loans, state.bankInterest, state.lastUpdated]);

  useEffect(() => {
    if (!isCloudEnabled()) return;
    let isOffline = false;

    const performPull = async () => {
      try {
        const cloudData = await pullFromCloud();
        if (cloudData && cloudData.lastUpdated && (!lastUpdatedRef.current || cloudData.lastUpdated > lastUpdatedRef.current)) {
          setState(prev => ({
            ...prev,
            ...cloudData,
            syncStatus: 'success'
          }));
        } else if (state.syncStatus !== 'success') {
          setState(prev => ({ ...prev, syncStatus: 'success' }));
        }
        isOffline = false;
      } catch (err) {
        if (err.message === 'NETWORK_OFFLINE') {
           if (!isOffline) {
             console.warn("[Sync] Cloud project unreachable. Operating locally.");
             isOffline = true;
           }
           setState(prev => ({ ...prev, syncStatus: 'error' }));
        }
      }
    };

    performPull();
    const interval = setInterval(performPull, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogin = (user) => {
    setState(prev => ({ ...prev, currentUser: user }));
  };

  const handleLogout = () => {
    setState(prev => ({ ...prev, currentUser: null }));
  };

  const updateState = useCallback((updater) => {
    setState(prev => {
        const nextState = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
        const finalState = { ...nextState, lastUpdated: Date.now(), syncStatus: 'syncing' };
        
        if (isCloudEnabled() && prev.currentUser?.role === UserRole.ADMIN) {
           pushToCloud(finalState)
             .then(() => setState(s => ({ ...s, syncStatus: 'success' })))
             .catch(() => {
                setState(s => ({ ...s, syncStatus: 'error' }));
             });
        }
        
        return finalState;
    });
  }, []);

  if (!state.currentUser) {
    return <Auth onLogin={handleLogin} users={state.users} />;
  }

  return (
    <Dashboard 
      state={state} 
      updateState={updateState} 
      onLogout={handleLogout} 
    />
  );
};

export default App;

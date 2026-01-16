
import { LoanType, UserRole } from '../types.js';
import { 
  SHORT_TERM_INTEREST_RATE, 
  LONG_TERM_INTEREST_RATE, 
  LONG_TERM_DURATION_MONTHS, 
  MONTHLY_CONTRIBUTION 
} from '../constants.js';

export const calculateNextEMI = (loan) => {
  if (loan.type === LoanType.SHORT_TERM) {
    const monthlyInterest = loan.amount * SHORT_TERM_INTEREST_RATE;
    if (loan.monthsElapsed >= 1) {
        return {
            totalEMI: loan.amount + (monthlyInterest * 2),
            principalComponent: loan.amount,
            interestComponent: monthlyInterest * 2,
            remainingBalance: 0
        };
    }
    return null;
  }

  const principalComponent = loan.amount / LONG_TERM_DURATION_MONTHS;
  const interestComponent = loan.principalRemaining * LONG_TERM_INTEREST_RATE;
  
  return {
    totalEMI: principalComponent + interestComponent,
    principalComponent,
    interestComponent,
    remainingBalance: Math.max(0, loan.principalRemaining - principalComponent)
  };
};

export const getUpcomingObligation = (userId, loans) => {
    let total = MONTHLY_CONTRIBUTION;
    const userActiveLoans = loans.filter(l => l.userId === userId && l.status === 'APPROVED');
    
    userActiveLoans.forEach(loan => {
        if (loan.type === LoanType.LONG_TERM) {
            const emi = calculateNextEMI(loan);
            if (emi) total += emi.totalEMI;
        } else if (loan.type === LoanType.SHORT_TERM && loan.monthsElapsed === 1) {
            const emi = calculateNextEMI(loan);
            if (emi) total += emi.totalEMI;
        }
    });
    
    return total;
};

export const getCommunityPendingDues = (users, loans, contributions, currentCycleMonth) => {
    let total = 0;
    
    users.filter(u => u.role !== UserRole.ADMIN).forEach(u => {
        const isPaid = contributions.some(c => c.userId === u.id && c.month === currentCycleMonth && c.status === 'PAID');
        if (!isPaid) total += MONTHLY_CONTRIBUTION;
    });

    loans.filter(l => l.status === 'APPROVED' && l.lastPaymentMonth !== currentCycleMonth).forEach(l => {
        const emi = calculateNextEMI(l);
        if (emi) total += emi.totalEMI;
    });

    return total;
};

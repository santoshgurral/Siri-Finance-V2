
export enum UserRole {
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER'
}

export enum LoanType {
  SHORT_TERM = 'SHORT_TERM',
  LONG_TERM = 'LONG_TERM'
}

export enum LoanStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PAID = 'PAID'
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  joinedDate: string;
}

export interface Contribution {
  id: string;
  userId: string;
  month: string;
  amount: number;
  status: 'PAID' | 'PENDING';
}

export interface Loan {
  id: string;
  userId: string;
  type: LoanType;
  amount: number;
  principalRemaining: number;
  status: LoanStatus;
  requestDate: string;
  approvalDate?: string;
  repaidAmount: number;
  interestCollected: number;
  monthsElapsed: number;
  lastPaymentMonth?: string;
}

export interface AppState {
  currentUser: User | null;
  users: User[];
  contributions: Contribution[];
  loans: Loan[];
  initialInterestEarned: number;
  bankInterest: number;
  lastUpdated?: number; // Timestamp of last change
  syncStatus?: 'idle' | 'syncing' | 'error' | 'success';
}

export interface EMIDetails {
  totalEMI: number;
  principalComponent: number;
  interestComponent: number;
  remainingBalance: number;
}

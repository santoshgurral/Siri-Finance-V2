
import { GoogleGenAI } from "@google/genai";
import { AppState } from "../types";

export const getFinancialAdvice = async (state: AppState): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const user = state.currentUser;
  if (!user) return "Please login to get advice.";

  const userLoans = state.loans.filter(l => l.userId === user.id);
  const userContributions = state.contributions.filter(c => c.userId === user.id);
  
  const totalPaid = state.contributions.filter(c => c.status === 'PAID').reduce((acc, c) => acc + c.amount, 0);
  const totalInterest = state.loans.reduce((acc, l) => acc + l.interestCollected, 0) + (state.initialInterestEarned || 0) + (state.bankInterest || 0);
  const liquidity = totalPaid + totalInterest;

  const prompt = `
    Context: You are a community finance assistant for Siri Finance. 
    User: ${user.name} (${user.role})
    User Loans: ${JSON.stringify(userLoans)}
    User Contributions: ${JSON.stringify(userContributions)}
    Total Fund Status: Current Cash Liquidity is ₹${liquidity.toLocaleString('en-IN')}.

    Tasks: 
    1. Provide a very short (2 sentence) summary of their financial standing.
    2. Give one specific tip on contribution consistency.
    3. Explain the community repayment rules clearly: 
       - Short Term Loans: 2% interest per month, total (Principal + 4% interest) paid in full after 2 months.
       - Long Term Loans: Repaid over 20 months. Monthly EMI = (Initial Principal / 20) + (1% of current remaining balance).
    Keep it friendly, professional, and concise. Use Markdown. Ensure any monetary figures you mention follow the Indian numbering system (e.g., 1,00,000 instead of 100,000).
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "Unable to generate insights at this time.";
  } catch (error) {
    console.error("AI Insight Error:", error);
    return "The AI assistant is temporarily unavailable.";
  }
};

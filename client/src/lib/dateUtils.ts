export function formatDate(date: Date, format: string): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  
  const monthsShort = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  switch (format) {
    case 'MMMM yyyy':
      return `${months[month]} ${year}`;
    case 'MMM d, yyyy':
      return `${monthsShort[month]} ${day}, ${year}`;
    case 'yyyy-MM-dd':
      return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    default:
      return date.toLocaleDateString();
  }
}

export function getCalendarDays(currentDate: Date): (Date | null)[] {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  // First day of the month
  const firstDay = new Date(year, month, 1);
  // Last day of the month
  const lastDay = new Date(year, month + 1, 0);
  
  // Days to show from previous month
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - firstDay.getDay());
  
  // Days to show from next month
  const endDate = new Date(lastDay);
  const daysToAdd = 6 - lastDay.getDay();
  endDate.setDate(endDate.getDate() + daysToAdd);
  
  const days: (Date | null)[] = [];
  const currentIterDate = new Date(startDate);
  
  while (currentIterDate <= endDate) {
    days.push(new Date(currentIterDate));
    currentIterDate.setDate(currentIterDate.getDate() + 1);
  }
  
  // Pad to ensure we have 42 days (6 weeks)
  while (days.length < 42) {
    days.push(null);
  }
  
  return days;
}

export function isToday(date: Date): boolean {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

export function isSameDay(date1: Date, date2: Date): boolean {
  return date1.toDateString() === date2.toDateString();
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function subtractDays(date: Date, days: number): Date {
  return addDays(date, -days);
}

export const TOUR_KEY = "dbrief_tour_v1_complete";

export function resetTour() {
  localStorage.removeItem(TOUR_KEY);
  window.dispatchEvent(new Event("dbrief:replay-tour"));
}

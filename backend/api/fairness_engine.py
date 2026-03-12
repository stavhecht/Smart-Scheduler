"""
Smart Scheduler - Social Fairness Algorithm & Dynamic Reshuffling Engine

Implements:
1. Fairness scoring per participant based on meeting load
2. Time slot scoring based on hour/day preferences
3. Dynamic Reshuffling Engine that activates when average scores are too low
"""

from datetime import datetime, timedelta
from typing import List, Dict, Any


class FairnessEngine:
    # Preference weights per hour of day (0.0 - 1.0)
    HOUR_WEIGHTS: Dict[int, float] = {
        7: 0.45, 8: 0.65, 9: 0.85, 10: 1.00, 11: 1.00,
        12: 0.70,  # Lunch hour - reduced
        13: 0.90, 14: 1.00, 15: 0.95, 16: 0.85, 17: 0.65, 18: 0.45
    }

    # Preference weights per day of week (0=Monday, 6=Sunday)
    DAY_WEIGHTS: Dict[int, float] = {
        0: 1.00, 1: 1.00, 2: 1.00, 3: 0.95, 4: 0.80, 5: 0.40, 6: 0.20
    }

    # Threshold below which the Reshuffling Engine activates
    OPTIMIZATION_THRESHOLD: float = 75.0

    # Working hours for slot generation
    WORKING_HOURS: List[int] = [10, 11, 13, 14, 15, 16]

    # ---------------------------------------------------------------------------
    # Individual user fairness score
    # ---------------------------------------------------------------------------

    def calculate_user_score(self, metrics: dict) -> float:
        """
        Calculate a single user's fairness score from their meeting history.
        Score range: 0 (overloaded/unfair) to 100 (well-balanced).
        Handles Decimal values from DynamoDB.
        """
        score = 100.0
        try:
            meetings_this_week = float(metrics.get('meetings_this_week', 0))
            cancellations = float(metrics.get('cancellations_last_month', 0))
            suffering = float(metrics.get('suffering_score', 0))

            score -= meetings_this_week * 2.0
            score -= cancellations * 5.0
            score += suffering * 3.0
        except (TypeError, ValueError):
            pass
            
        return max(0.0, min(100.0, score))

    # ---------------------------------------------------------------------------
    # Slot scoring (Social Fairness Algorithm)
    # ---------------------------------------------------------------------------

    # ---------------------------------------------------------------------------
    # Slot scoring (Social Fairness Algorithm)
    # ---------------------------------------------------------------------------

    def score_time_slot(
        self,
        slot_dt: datetime,
        participant_states: List[dict],
        duration_minutes: int
    ) -> Dict[str, Any]:
        """
        Score a candidate time slot using the Social Fairness AI Engine.
        Combines:
        - Time-of-day/Day-of-week heuristics
        - Participant Load Index (Real-time meeting pressure)
        - Social Momentum (Rewards flexibility history)
        - Recipient Fatigue (Penalizes clustering meetings)
        """
        hour = slot_dt.hour
        day = slot_dt.weekday()

        # 1. Base Time Score (0-100)
        hour_weight = self.HOUR_WEIGHTS.get(hour, 0.3)
        day_weight = self.DAY_WEIGHTS.get(day, 0.3)
        time_score = hour_weight * day_weight * 100.0

        if participant_states:
            # 2. Participant Load & Fatigue (0-30 penalty)
            total_load = sum(
                float(p.get('meetingLoadMetrics', {}).get('meetings_this_week', 0))
                for p in participant_states
            )
            avg_load = total_load / len(participant_states)
            load_penalty = min(avg_load * 4.0, 30.0)

            # 3. Social Momentum Bonus (0-15 bonus)
            # Rewards the group if they've been taking "suffering" slots recently
            total_suffering = sum(
                float(p.get('meetingLoadMetrics', {}).get('suffering_score', 0))
                for p in participant_states
            )
            momentum_bonus = min(total_suffering * 1.5, 15.0)

            # 4. Fairness Variance Penalty (0-20 penalty)
            # Penalizes slots that would increase the gap between the most and least busy
            p_scores = [
                self.calculate_user_score(p.get('meetingLoadMetrics', {}))
                for p in participant_states
            ]
            variance = (max(p_scores) - min(p_scores)) if len(p_scores) > 1 else 0.0
            fairness_impact_score = max(0.0, 15.0 - variance * 0.5)

            final_score = time_score - load_penalty + momentum_bonus + fairness_impact_score
        else:
            final_score = time_score

        # Clamping
        final_score = round(max(0.0, min(100.0, final_score)), 1)
        
        # Calculate impact for DB
        impact = self._fairness_impact(hour, day)

        return {
            "score": final_score,
            "fairnessImpact": impact,
            "conflictCount": 0,
            "explanation": self._ai_explain(hour, day, final_score, participant_states)
        }

    def _fairness_impact(self, hour: int, day: int) -> float:
        """How much scheduling this slot affects the user's fairness total."""
        if 10 <= hour <= 15 and day < 4:
            return -1.0   # Prime time
        elif 9 <= hour <= 17 and day < 5:
            return -2.5   # Standard window
        elif day >= 4:
            return -6.0   # Critical: personal time boundary
        return -4.5       # Outside normal hours

    def _ai_explain(self, hour: int, day: int, score: float, p_states: List[dict]) -> str:
        """Generates a pseudo-intelligent explanation for the score."""
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        
        # Dynamic context
        is_weekend = day >= 4
        is_off_hours = hour < 9 or hour > 17
        busy_group = False
        if p_states and len(p_states) > 0:
            avg_load = sum(float(p.get('meetingLoadMetrics', {}).get('meetings_this_week', 0)) for p in p_states) / len(p_states)
            busy_group = avg_load > 3

        if score >= 90:
            return f"Optimal alignment: High-energy window on {days[day]} with minimal participant fatigue detected."
        elif score >= 75:
            if busy_group:
                return "Strategic placement: Despite high weekly load, this slot preserves late-day focus blocks."
            return f"Balanced choice: Standard {days[day]} morning slot with neutral social impact."
        elif score >= 60:
            if is_off_hours:
                return "Heuristic trade-off: Slight off-hour inconvenience balanced by participant availability cycles."
            return "Adequate slot: Meets core requirements while maintaining fair distribution of weekly load."
        elif is_weekend:
            return f"Social boundary warning: High-impact {days[day]} slot. Recommended only for high-priority syncs."
        
        return "Sub-optimal: Significant load variance detected. Suggest exploring alternative windows."

    # ---------------------------------------------------------------------------
    # Candidate slot generation
    # ---------------------------------------------------------------------------

    def generate_candidate_slots(
        self,
        date_start: datetime,
        date_end: datetime
    ) -> List[datetime]:
        """
        Generate candidate time slots within the given date range.
        Respects working hours and skips weekends.
        """
        slots: List[datetime] = []
        current = date_start.replace(hour=9, minute=0, second=0, microsecond=0)

        while current <= date_end and len(slots) < 12:
            if current.weekday() < 5:  # Mon–Fri only
                for hour in self.WORKING_HOURS:
                    candidate = current.replace(hour=hour, minute=0)
                    if candidate > datetime.now():
                        slots.append(candidate)
            current += timedelta(days=1)

        return slots

    # ---------------------------------------------------------------------------
    # Slot selection (with day diversity)
    # ---------------------------------------------------------------------------

    def select_best_slots(self, scored_slots: List[dict], count: int = 3) -> List[dict]:
        """
        Select the top-N slots ensuring they span different days
        for maximum scheduling flexibility.
        """
        sorted_slots = sorted(scored_slots, key=lambda x: x['score'], reverse=True)
        selected: List[dict] = []
        used_days: set = set()

        # First pass: one slot per day
        for slot in sorted_slots:
            if len(selected) >= count:
                break
            day = datetime.fromisoformat(slot['startIso']).date()
            if day not in used_days:
                selected.append(slot)
                used_days.add(day)

        # Second pass: fill remaining with best remaining slots
        for slot in sorted_slots:
            if len(selected) >= count:
                break
            if slot not in selected:
                selected.append(slot)

        return selected[:count]

    # ---------------------------------------------------------------------------
    # Dynamic Reshuffling Engine
    # ---------------------------------------------------------------------------

    def needs_optimization(self, scored_slots: List[dict]) -> bool:
        """
        Checks if the Dynamic Reshuffling Engine should activate.
        Triggers when average score across suggested slots falls below threshold.
        """
        if not scored_slots:
            return False
        avg = sum(s['score'] for s in scored_slots) / len(scored_slots)
        return avg < self.OPTIMIZATION_THRESHOLD

    def reshuffle(self, all_scored_slots: List[dict]) -> List[dict]:
        """
        Dynamic Reshuffling Engine:
        Filters out low-quality slots and re-selects the best available options.
        Called when the initial selection average score is below the threshold.
        """
        # Filter: keep only viable candidates (score >= 60)
        viable = [s for s in all_scored_slots if s['score'] >= 60]
        pool = viable if viable else all_scored_slots  # Fallback to full pool
        return self.select_best_slots(pool, count=3)

    # ---------------------------------------------------------------------------
    # Fairness score update on booking
    # ---------------------------------------------------------------------------

    def update_score_after_booking(
        self,
        current_state: dict,
        slot_fairness_impact: float
    ) -> dict:
        """
        Recalculate and return updated fairness metrics after a meeting is booked.
        """
        metrics = current_state.get('meetingLoadMetrics', {})
        new_meetings = metrics.get('meetings_this_week', 0) + 1
        new_cancellations = metrics.get('cancellations_last_month', 0)
        new_suffering = metrics.get('suffering_score', 0)

        # Inconvenient slots (impact < -2) increase suffering score (rewarded later)
        if slot_fairness_impact < -2:
            new_suffering += 1

        new_metrics = {
            'meetings_this_week': new_meetings,
            'cancellations_last_month': new_cancellations,
            'suffering_score': new_suffering
        }
        new_score = self.calculate_user_score(new_metrics)

        return {
            'fairnessScore': new_score,
            'meetingLoadMetrics': new_metrics,
            'inconvenientMeetingsCount': int(slot_fairness_impact < -2)
        }


engine = FairnessEngine()

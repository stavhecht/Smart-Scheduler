"""
Smart Scheduler - Social Fairness Algorithm & Dynamic Reshuffling Engine

Implements:
1. Fairness scoring per participant based on meeting load
2. Time slot scoring based on hour/day preferences
3. Dynamic Reshuffling Engine that activates when average scores are too low
"""

import math
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional


class FairnessEngine:
    # Preference weights per hour of day (0.0 - 1.0)
    HOUR_WEIGHTS: Dict[int, float] = {
        7: 0.45, 8: 0.65, 9: 0.85, 10: 1.00, 11: 1.00,
        12: 0.15,  # Default lunch hour — very low (avoid scheduling during lunch)
        13: 0.90, 14: 1.00, 15: 0.95, 16: 0.85, 17: 0.65, 18: 0.45
    }

    # Day-of-week weights derived from per-user working days.
    # Working days score at full weight; non-working days are heavily discounted.
    WORKING_DAY_WEIGHT: float  = 1.0
    REST_DAY_WEIGHT: float     = 0.2
    LUNCH_BREAK_WEIGHT: float  = 0.15  # Applied to any configured lunch break hour

    # Threshold below which the Reshuffling Engine activates
    OPTIMIZATION_THRESHOLD: float = 75.0

    # Working hours for slot generation
    WORKING_HOURS: List[int] = [10, 11, 13, 14, 15, 16]

    # ---------------------------------------------------------------------------
    # Individual user fairness score
    # ---------------------------------------------------------------------------

    def calculate_user_score(
        self,
        metrics: dict,
        last_updated: Optional[str] = None,
        group_avg_meetings: float = 0.0,
    ) -> float:
        """
        Fairness score (0–100). Higher = this person deserves scheduling priority.

        Logic:
        - Relative overload (meetings above group average) is penalised heavily.
        - Absolute meeting count adds a small base penalty.
        - Recent cancellations (last 30 days) cost points; halved vs. old formula so
          rescheduling is not punished excessively.
        - Passive recovery: score drifts back to 100 when a user is inactive.
        """
        score = 100.0
        try:
            meetings = float(metrics.get('meetings_this_week', 0))

            cutoff = datetime.now() - timedelta(days=30)
            recent_cancellations = sum(
                1 for ts in metrics.get('cancellation_timestamps', [])
                if datetime.fromisoformat(str(ts)) > cutoff
            )

            # Relative overload: penalise being above the group's average load
            relative_load = max(0.0, meetings - group_avg_meetings)
            score -= relative_load * 5.0
            # Absolute load: small per-meeting base cost
            score -= meetings * 1.0
            # Cancellation penalty (2.5 pts each; expires after 30 days)
            score -= recent_cancellations * 2.5
        except (TypeError, ValueError):
            pass

        # Passive recovery: up to +20 pts for inactivity (0.5 pts/day)
        if last_updated:
            try:
                days_inactive = (datetime.now() - datetime.fromisoformat(str(last_updated))).days
                score += min(days_inactive * 0.5, 20.0)
            except (ValueError, TypeError):
                pass

        return max(0.0, min(100.0, score))

    # ---------------------------------------------------------------------------
    # Slot scoring (Social Fairness Algorithm)
    # ---------------------------------------------------------------------------

    def _is_lunch_hour(self, hour: int, lunch_break: Optional[dict]) -> bool:
        """Return True if `hour` falls within the participant's configured lunch window."""
        if not lunch_break:
            return False
        try:
            start_hour = int(str(lunch_break.get('start', '12:00')).split(':')[0])
            duration   = int(lunch_break.get('duration', 60))
            end_hour   = start_hour + max(1, math.ceil(duration / 60))
            return start_hour <= hour < end_hour
        except (ValueError, TypeError):
            return False

    def score_time_slot(
        self,
        slot_dt: datetime,
        participant_states: List[dict],
        _duration_minutes: int,
        tz_offset_hours: float = 0.0,
        participant_tz_offsets: Optional[List[float]] = None,
        participant_working_days: Optional[List[List[int]]] = None,
        participant_lunch_breaks: Optional[List[Optional[dict]]] = None,
        busy_count: int = 0,
    ) -> Dict[str, Any]:
        """
        Score a candidate time slot using the Social Fairness AI Engine.
        Combines:
        - Time-of-day/Day-of-week heuristics (averaged across all participant timezones)
        - Participant Load Index (Real-time meeting pressure)
        - Social Momentum (Rewards flexibility history)
        - Fairness Variance (Penalizes unequal load distribution)
        - Calendar Conflict Penalty (Penalizes slots that clash with existing events)

        tz_offset_hours: UTC offset for the organizer (used for impact scoring & explanation).
        participant_tz_offsets: list of UTC offsets for all participants (inc. organizer).
                                When provided, time_score is averaged across all local times.
        busy_count: number of participants with a calendar conflict at this slot.
        """
        # Organizer's local time — used for fairness impact and explanation text
        local_dt = slot_dt + timedelta(hours=tz_offset_hours)
        hour = local_dt.hour
        day = local_dt.weekday()

        # 1. Base Time Score — averaged across all participant local times when available
        if participant_tz_offsets:
            p_time_scores = []
            for i, offset in enumerate(participant_tz_offsets):
                p_local = slot_dt + timedelta(hours=offset)

                lb  = participant_lunch_breaks[i] if participant_lunch_breaks and i < len(participant_lunch_breaks) else None
                hw  = self.LUNCH_BREAK_WEIGHT if self._is_lunch_hour(p_local.hour, lb) else self.HOUR_WEIGHTS.get(p_local.hour, 0.3)

                if participant_working_days and i < len(participant_working_days):
                    pwd = participant_working_days[i]
                else:
                    pwd = [0, 1, 2, 3, 4]

                dw = self.WORKING_DAY_WEIGHT if p_local.weekday() in pwd else self.REST_DAY_WEIGHT
                p_time_scores.append(hw * dw * 100.0)
            time_score = sum(p_time_scores) / len(p_time_scores)
        else:
            lb0          = participant_lunch_breaks[0] if participant_lunch_breaks else None
            hour_weight  = self.LUNCH_BREAK_WEIGHT if self._is_lunch_hour(hour, lb0) else self.HOUR_WEIGHTS.get(hour, 0.3)

            if participant_working_days and len(participant_working_days) > 0:
                pwd = participant_working_days[0]
            else:
                pwd = [0, 1, 2, 3, 4]

            day_weight = self.WORKING_DAY_WEIGHT if day in pwd else self.REST_DAY_WEIGHT
            time_score = hour_weight * day_weight * 100.0

        if participant_states:
            # 2. Participant Load & Fatigue (0-30 penalty)
            total_load = sum(
                float(p.get('meetingLoadMetrics', {}).get('meetings_this_week', 0))
                for p in participant_states
            )
            avg_load = total_load / len(participant_states)
            load_penalty = min(avg_load * 4.0, 30.0)

            # 3. Equity Bonus — rewards slots that equalise load across participants
            p_scores = [
                self.calculate_user_score(
                    p.get('meetingLoadMetrics', {}),
                    p.get('lastUpdatedAt'),
                    group_avg_meetings=avg_load,
                )
                for p in participant_states
            ]
            variance = (max(p_scores) - min(p_scores)) if len(p_scores) > 1 else 0.0
            equity_bonus = max(-15.0, 20.0 - variance * 0.4)

            final_score = time_score - load_penalty + equity_bonus
        else:
            load_penalty = 0.0
            equity_bonus = 20.0
            final_score = time_score

        # 4. Calendar Conflict Penalty — 12 pts per conflicting participant, max 36
        if busy_count > 0:
            final_score -= min(busy_count * 12.0, 36.0)

        # Clamping
        final_score = round(max(0.0, min(100.0, final_score)), 1)

        impact = self._fairness_impact(hour, day)

        return {
            "score": final_score,
            "fairnessImpact": impact,
            "conflictCount": busy_count,
            "explanation": "",
            "_hour": hour,
            "_day": day,
            "_load_penalty": load_penalty,
            "_equity_bonus": equity_bonus,
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

    def explain_slot(self, hour: int, day: int, score: float, load_penalty: float, equity_bonus: float) -> str:
        """Heuristic explanation used when AI ranking is unavailable."""
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        parts = []
        hw = self.HOUR_WEIGHTS.get(hour, 0.3)
        if hw >= 0.9:
            parts.append(f"prime {days[day]} window")
        elif hw <= 0.3:
            parts.append(f"off-peak hour ({hour}:00)")
        if load_penalty > 20:
            parts.append("group heavily loaded this week")
        if equity_bonus < 0:
            parts.append("uneven load distribution between participants")
        elif equity_bonus > 15:
            parts.append("load well-balanced across participants")
        if day >= 5:
            parts.append("weekend slot")
        if not parts:
            parts.append("standard working window")
        qualifier = "Good" if score >= 70 else ("Fair" if score >= 50 else "Poor")
        return f"{qualifier} slot: {', '.join(parts)}."

    # ---------------------------------------------------------------------------
    # Candidate slot generation
    # ---------------------------------------------------------------------------

    def generate_candidate_slots(
        self,
        date_start: datetime,
        date_end: datetime,
        tz_offset_hours: float = 0.0,
        working_hours: Optional[List[int]] = None,
        working_days: Optional[List[int]] = None,
    ) -> List[datetime]:
        """
        Generate candidate time slots within the given date range.
        Respects working hours (in the organizer's local timezone) and skips weekends.

        tz_offset_hours: UTC offset for the organizer. Hours are treated as local and
                         converted back to UTC for storage.
        working_hours: optional list of local hours to use (e.g. [9, 10, 11, 13, 14]).
                       When provided (from participant profile intersection) this overrides
                       the class default WORKING_HOURS.
        """
        hours = working_hours if working_hours else self.WORKING_HOURS
        allowed_days = set(working_days) if working_days is not None else set(range(7))
        slots: List[datetime] = []
        now_utc = datetime.utcnow()
        current = date_start.replace(hour=9, minute=0, second=0, microsecond=0)

        while current.date() <= date_end.date():
            if current.weekday() in allowed_days:
                for local_hour in hours:
                    # Convert local hour → UTC using full fractional offset (e.g. UTC+5:30)
                    utc_total_min = local_hour * 60 - round(tz_offset_hours * 60)
                    utc_h = (utc_total_min // 60) % 24
                    utc_m = utc_total_min % 60
                    candidate = current.replace(hour=utc_h, minute=utc_m)
                    if utc_total_min < 0:
                        candidate -= timedelta(days=1)
                    elif utc_total_min >= 1440:
                        candidate += timedelta(days=1)
                    if candidate > now_utc:
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

    def reshuffle(self, all_scored_slots: List[dict], count: int = 8) -> List[dict]:
        """
        Dynamic Reshuffling Engine:
        Filters out low-quality slots and re-selects the best available options.
        Called when the initial selection average score is below the threshold.
        """
        viable = [s for s in all_scored_slots if s['score'] >= 60]
        pool = viable if viable else all_scored_slots
        return self.select_best_slots(pool, count=count)

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

        Inconvenient slots (impact < -2) → suffering +1 → net score gain.
        Prime slots (impact == -1.0) → prime_slots_accepted +1 → score gain every 3.
        """
        metrics = current_state.get('meetingLoadMetrics', {})
        new_meetings      = int(metrics.get('meetings_this_week', 0)) + 1
        new_suffering     = int(metrics.get('suffering_score', 0))
        new_prime         = int(metrics.get('prime_slots_accepted', 0))
        cancel_timestamps = list(metrics.get('cancellation_timestamps', []))

        is_inconvenient = slot_fairness_impact < -2

        new_metrics = {
            'meetings_this_week':      new_meetings,
            'suffering_score':         new_suffering + (1 if is_inconvenient else 0),
            'prime_slots_accepted':    new_prime,
            'cancellation_timestamps': cancel_timestamps,
        }
        last_updated = current_state.get('lastUpdatedAt')
        new_score = self.calculate_user_score(new_metrics, last_updated)

        return {
            'fairnessScore':             new_score,
            'meetingLoadMetrics':        new_metrics,
            'inconvenientMeetingsCount': int(is_inconvenient),
        }

    def update_score_after_cancel(self, current_state: dict) -> dict:
        """
        Recalculate fairness metrics after the organizer cancels a meeting.
        Adds a cancellation timestamp (expires after 30 days) instead of a raw counter.
        """
        metrics = current_state.get('meetingLoadMetrics', {})
        cancel_timestamps = list(metrics.get('cancellation_timestamps', []))
        cancel_timestamps.append(datetime.now().isoformat())

        new_metrics = {
            **metrics,
            'cancellation_timestamps': cancel_timestamps,
        }
        last_updated = current_state.get('lastUpdatedAt')
        new_score = self.calculate_user_score(new_metrics, last_updated)

        return {
            'fairnessScore':      new_score,
            'meetingLoadMetrics': new_metrics,
        }


engine = FairnessEngine()

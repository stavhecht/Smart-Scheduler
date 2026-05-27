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
    # Preference weights per hour of day (0.0 - 1.0).
    # Hours outside this table default to 0.15 (very off-peak).
    HOUR_WEIGHTS: Dict[int, float] = {
        6: 0.25,
        7: 0.45, 8: 0.65, 9: 0.85, 10: 1.00, 11: 1.00,
        12: 0.15,  # Default lunch hour — very low (avoid scheduling during lunch)
        13: 0.90, 14: 1.00, 15: 0.95, 16: 0.85,
        17: 0.70, 18: 0.55, 19: 0.40, 20: 0.30, 21: 0.20,
    }

    # Day-of-week weights derived from per-user working days.
    # Working days score at full weight; non-working days are heavily discounted.
    WORKING_DAY_WEIGHT: float  = 1.0
    REST_DAY_WEIGHT: float     = 0.2
    LUNCH_BREAK_WEIGHT: float  = 0.15  # Applied to any configured lunch break hour

    # Threshold below which the Reshuffling Engine activates
    OPTIMIZATION_THRESHOLD: float = 60.0

    # Working hours for slot generation
    WORKING_HOURS: List[int] = [10, 11, 13, 14, 15, 16]

    # ---------------------------------------------------------------------------
    # Individual user fairness score
    # ---------------------------------------------------------------------------

    def calculate_user_score(
        self,
        metrics: dict,
        last_updated: Optional[str] = None,
        **kwargs,
    ) -> float:
        """
        Fairness score (0–100). 50 = neutral.
        Above 50 = owed a good slot (accepted inconvenient meetings).
        Below 50 = has been getting good slots (owes consideration to others).

        Derived from `fairness_balance` in metrics, which accumulates:
          +15 for weekend meetings (significant sacrifice)
          +8  for off-peak meetings (some sacrifice)
          -4  for standard working-hours meetings
          -10 for prime-time meetings (you got a great deal)

        Balance drifts back toward 0 (neutral) at 2%/day so old history fades.
        """
        balance = float(metrics.get('fairness_balance', 0.0))
        # Drift toward 0 (neutral) — 2% per day, capped at 30% total
        if last_updated:
            try:
                days = (datetime.now() - datetime.fromisoformat(str(last_updated))).days
                drift_pct = min(days * 0.02, 0.30)
                balance = balance * (1.0 - drift_pct)
            except (ValueError, TypeError):
                pass
        return max(0.0, min(100.0, 50.0 + balance))

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

        # 1. Per-participant time quality — collected for both time_score and equity calc
        p_time_qualities: List[float] = []
        if participant_tz_offsets:
            for i, offset in enumerate(participant_tz_offsets):
                p_local = slot_dt + timedelta(hours=offset)
                lb  = participant_lunch_breaks[i] if participant_lunch_breaks and i < len(participant_lunch_breaks) else None
                hw  = self.LUNCH_BREAK_WEIGHT if self._is_lunch_hour(p_local.hour, lb) else self.HOUR_WEIGHTS.get(p_local.hour, 0.15)
                pwd = participant_working_days[i] if participant_working_days and i < len(participant_working_days) else [0, 1, 2, 3, 4]
                dw  = self.WORKING_DAY_WEIGHT if p_local.weekday() in pwd else self.REST_DAY_WEIGHT
                p_time_qualities.append(hw * dw * 100.0)
            time_score = sum(p_time_qualities) / len(p_time_qualities)
        else:
            lb0         = participant_lunch_breaks[0] if participant_lunch_breaks else None
            hour_weight = self.LUNCH_BREAK_WEIGHT if self._is_lunch_hour(hour, lb0) else self.HOUR_WEIGHTS.get(hour, 0.15)
            pwd         = participant_working_days[0] if participant_working_days else [0, 1, 2, 3, 4]
            day_weight  = self.WORKING_DAY_WEIGHT if day in pwd else self.REST_DAY_WEIGHT
            tq          = hour_weight * day_weight * 100.0
            p_time_qualities = [tq] * (len(participant_states) if participant_states else 1)
            time_score  = tq

        if participant_states:
            # 2. Participant Load penalty (0-30)
            total_load = sum(
                float(p.get('meetingLoadMetrics', {}).get('meetings_this_week', 0))
                for p in participant_states
            )
            avg_load = total_load / len(participant_states)
            load_penalty = min(avg_load * 4.0, 30.0)

            # 3. Equity alignment: reward slots that give convenient time to the most-deserving
            # participant (highest fairness score = most owed a good slot).
            p_fairness = [
                self.calculate_user_score(p.get('meetingLoadMetrics', {}), p.get('lastUpdatedAt'))
                for p in participant_states
            ]
            if len(p_fairness) > 1 and max(p_fairness) > min(p_fairness):
                max_fs = max(p_fairness)
                weights = [fs / max_fs for fs in p_fairness]
                w_sum = sum(weights)
                weighted_avg = sum(w * q for w, q in zip(weights, p_time_qualities)) / w_sum
                unweighted_avg = sum(p_time_qualities) / len(p_time_qualities)
                # Positive when high-fairness participants get more convenient time
                equity_bonus = (weighted_avg - unweighted_avg) * 30.0
                equity_bonus = max(-15.0, min(15.0, equity_bonus))
            else:
                equity_bonus = 5.0  # single participant or all equal — small neutral bonus

            final_score = time_score - load_penalty + equity_bonus
        else:
            load_penalty = 0.0
            equity_bonus = 5.0
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
        Dynamic Reshuffling Engine: re-selects the best available slots.
        Preferred slots (user-requested time window) are always included regardless
        of score; non-preferred slots are filtered to score >= 40.
        """
        preferred = [s for s in all_scored_slots if s.get("isPreferred")]
        rest = [s for s in all_scored_slots if not s.get("isPreferred") and s["score"] >= 40]
        pool = (
            sorted(preferred, key=lambda s: -s["score"]) +
            sorted(rest, key=lambda s: -s["score"])
        )
        if not pool:
            pool = sorted(all_scored_slots, key=lambda s: -s["score"])
        return self.select_best_slots(pool, count=count)

    # ---------------------------------------------------------------------------
    # Fairness score update on booking
    # ---------------------------------------------------------------------------

    # Balance delta table: maps fairness_impact to balance change
    _IMPACT_TO_DELTA: List[tuple] = [
        (-5.0, +15),  # weekend / very off-hours → significant sacrifice
        (-3.5, +8),   # off-peak hours → some sacrifice
        (-1.5, -4),   # standard working hours → small cost
        (0.0,  -10),  # prime time → you got a great deal
    ]

    def _impact_to_balance_delta(self, impact: float) -> int:
        for threshold, delta in self._IMPACT_TO_DELTA:
            if impact <= threshold:
                return delta
        return -10

    def update_score_after_booking(
        self,
        current_state: dict,
        slot_fairness_impact: float
    ) -> dict:
        """
        Update fairness balance after a meeting is booked.

        Credit/debt model:
          Inconvenient slot (off-hours / weekend) → balance UP → score rises above 50
          Convenient slot (prime time)            → balance DOWN → score drops below 50

        This way the score tracks "how much good scheduling I'm owed":
          50 = neutral, 100 = highly owed, 0 = has been getting great slots
        """
        metrics = current_state.get('meetingLoadMetrics', {})
        balance = float(metrics.get('fairness_balance', 0.0))
        delta   = self._impact_to_balance_delta(slot_fairness_impact)
        balance = max(-50.0, min(50.0, balance + delta))

        is_inconvenient = delta > 0

        new_metrics = {
            **metrics,
            'fairness_balance':        round(balance, 1),
            'meetings_this_week':      int(metrics.get('meetings_this_week', 0)) + 1,
            'cancellation_timestamps': list(metrics.get('cancellation_timestamps', [])),
            'inconvenient_count':      int(metrics.get('inconvenient_count', 0)) + (1 if is_inconvenient else 0),
            'convenient_count':        int(metrics.get('convenient_count', 0)) + (0 if is_inconvenient else 1),
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
        Update fairness after the organizer cancels a meeting.
        Cancellation penalises the balance (you broke others' plans) — −5 pts.
        """
        metrics = current_state.get('meetingLoadMetrics', {})
        balance = float(metrics.get('fairness_balance', 0.0))
        balance = max(-50.0, balance - 5.0)  # cancellation penalty

        cancel_timestamps = list(metrics.get('cancellation_timestamps', []))
        cancel_timestamps.append(datetime.now().isoformat())

        new_metrics = {
            **metrics,
            'fairness_balance':        round(balance, 1),
            'cancellation_timestamps': cancel_timestamps,
        }
        last_updated = current_state.get('lastUpdatedAt')
        new_score = self.calculate_user_score(new_metrics, last_updated)

        return {
            'fairnessScore':      new_score,
            'meetingLoadMetrics': new_metrics,
        }


engine = FairnessEngine()

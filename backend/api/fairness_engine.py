class FairnessEngine:
    def calculate_score(self, user_history: dict) -> float:
        score = 100.0
        meetings_count = user_history.get('meetings_this_week', 0)
        score -= (meetings_count * 2)
        cancellations = user_history.get('cancellations_last_month', 0)
        score -= (cancellations * 5)
        suffering_index = user_history.get('suffering_score', 0)
        score += (suffering_index * 3)
        return max(0.0, min(100.0, score))

engine = FairnessEngine()
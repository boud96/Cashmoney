class LocalApiCorsMiddleware:
    """Allow the future Electron renderer or local frontend dev server to call the API."""

    allowed_origins = {
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "http://127.0.0.1:8765",
        "http://localhost:8765",
    }
    unsafe_methods = {"POST", "PATCH", "PUT", "DELETE"}

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        origin = request.headers.get("Origin")
        requested_method = request.headers.get("Access-Control-Request-Method", "")
        is_unsafe_request = request.method in self.unsafe_methods
        is_unsafe_preflight = (
            request.method == "OPTIONS"
            and requested_method.upper() in self.unsafe_methods
        )
        if (
            origin
            and origin not in self.allowed_origins
            and (is_unsafe_request or is_unsafe_preflight)
        ):
            from django.http import JsonResponse

            return JsonResponse(
                {
                    "error": "Origin is not allowed",
                    "details": {"origin": origin},
                },
                status=403,
            )

        if request.method == "OPTIONS":
            from django.http import HttpResponse

            response = HttpResponse()
        else:
            response = self.get_response(request)

        if origin in self.allowed_origins:
            response["Access-Control-Allow-Origin"] = origin
            response["Access-Control-Allow-Credentials"] = "true"
            response["Access-Control-Allow-Headers"] = "Content-Type, X-CSRFToken"
            response["Access-Control-Allow-Methods"] = (
                "GET, POST, PATCH, DELETE, OPTIONS"
            )
        return response

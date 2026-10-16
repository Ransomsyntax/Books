from django.urls import path

from . import api

urlpatterns = [
    path('me/', api.me),
    path('organization/', api.organization),
    path('dashboard/', api.dashboard_view),
    path('activity/', api.activity_view),
    path('search/', api.search_view),
    path('lookup/<slug:name>/', api.lookup),
    path('<slug:name>/', api.collection),
    path('<slug:name>/<int:pk>/', api.item),
    path('<slug:name>/<int:pk>/<slug:act>/', api.action),
]

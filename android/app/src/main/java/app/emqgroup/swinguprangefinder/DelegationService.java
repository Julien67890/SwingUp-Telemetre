package app.emqgroup.swinguprangefinder;


import com.google.androidbrowserhelper.playbilling.digitalgoods.DigitalGoodsRequestHandler;
import com.google.androidbrowserhelper.locationdelegation.LocationDelegationExtraCommandHandler;


public class DelegationService extends
        com.google.androidbrowserhelper.trusted.DelegationService {
    @Override
    public void onCreate() {
        super.onCreate();

        
            registerExtraCommandHandler(new DigitalGoodsRequestHandler(getApplicationContext()));
            registerExtraCommandHandler(new LocationDelegationExtraCommandHandler());
        
    }
}

